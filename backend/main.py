import asyncio
import json
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

load_dotenv()

from .agent import agent_loop, broadcast, get_active_session, set_queue
from .database import get_conn, init_db
from .memory import get_all_memory, record_response

_broadcast_queue: asyncio.Queue = asyncio.Queue()
_clients: list[WebSocket] = []

FRONTEND_DIR = Path(__file__).parent.parent / "frontend"


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    set_queue(_broadcast_queue)
    asyncio.create_task(agent_loop())
    asyncio.create_task(_broadcaster())
    yield


app = FastAPI(title="Anchor", lifespan=lifespan)


async def _broadcaster():
    while True:
        data = await _broadcast_queue.get()
        dead = []
        for ws in _clients:
            try:
                await ws.send_json(data)
            except Exception:
                dead.append(ws)
        for ws in dead:
            _clients.remove(ws)


# ── Models ────────────────────────────────────────────────────────────────────

class SessionStart(BaseModel):
    intent: str
    mode: str = "deep"  # light | deep | locked


class EventPayload(BaseModel):
    source: str          # chrome | glasses | simulator
    type: str            # tab_change | accel_snapshot | idle | app_switch
    payload: dict


class CheckpointResponseBody(BaseModel):
    response: str        # continue | switch | ignored


# ── Routes ────────────────────────────────────────────────────────────────────

@app.post("/session/start")
async def start_session(body: SessionStart):
    conn = get_conn()
    conn.execute("UPDATE focus_sessions SET active=0 WHERE active=1")
    cursor = conn.execute(
        "INSERT INTO focus_sessions (intent, mode, started_at) VALUES (?,?,?)",
        (body.intent, body.mode, datetime.now().isoformat()),
    )
    session_id = cursor.lastrowid
    conn.commit()
    conn.close()
    await broadcast({"type": "session_started", "intent": body.intent, "mode": body.mode, "session_id": session_id})
    return {"session_id": session_id}


@app.post("/session/end")
async def end_session():
    conn = get_conn()
    conn.execute(
        "UPDATE focus_sessions SET active=0, ended_at=? WHERE active=1",
        (datetime.now().isoformat(),),
    )
    conn.commit()
    conn.close()
    await broadcast({"type": "session_ended"})
    return {"ok": True}


@app.get("/session/current")
async def current_session():
    return get_active_session() or {}


@app.post("/events")
async def ingest_event(body: EventPayload):
    session = get_active_session()
    if not session:
        return {"ok": False, "reason": "no active session"}
    conn = get_conn()
    conn.execute(
        "INSERT INTO activity_events (session_id, timestamp, source, type, payload) VALUES (?,?,?,?,?)",
        (session["id"], datetime.now().isoformat(), body.source, body.type, json.dumps(body.payload)),
    )
    conn.commit()
    conn.close()
    await broadcast({"type": "new_event", "source": body.source, "event_type": body.type, "payload": body.payload})
    return {"ok": True}


@app.post("/checkpoint/{drift_check_id}/response")
async def checkpoint_response(drift_check_id: int, body: CheckpointResponseBody):
    conn = get_conn()
    conn.execute(
        "INSERT INTO checkpoint_responses (drift_check_id, response, responded_at) VALUES (?,?,?)",
        (drift_check_id, body.response, datetime.now().isoformat()),
    )
    # Pull domain + session context to update memory
    row = conn.execute(
        """
        SELECT fs.intent, fs.mode, ae.payload
        FROM drift_checks dc
        JOIN focus_sessions fs ON dc.session_id = fs.id
        LEFT JOIN activity_events ae ON ae.session_id = fs.id AND ae.type = 'tab_change'
        WHERE dc.id = ?
        ORDER BY ae.timestamp DESC LIMIT 1
        """,
        (drift_check_id,),
    ).fetchone()
    conn.commit()
    conn.close()

    if row and row["payload"]:
        domain = json.loads(row["payload"]).get("domain", "unknown")
        record_response(domain, row["intent"], row["mode"], body.response)

    await broadcast({"type": "checkpoint_response", "drift_check_id": drift_check_id, "response": body.response})
    return {"ok": True}


@app.get("/memory")
async def memory():
    return get_all_memory()


# ── WebSocket ─────────────────────────────────────────────────────────────────

@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    await ws.accept()
    _clients.append(ws)
    # Send current session state on connect
    session = get_active_session()
    if session:
        await ws.send_json({"type": "session_started", "intent": session["intent"], "mode": session["mode"]})
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        if ws in _clients:
            _clients.remove(ws)


# ── Static / dashboard ────────────────────────────────────────────────────────

app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")


@app.get("/")
async def dashboard():
    return FileResponse(str(FRONTEND_DIR / "index.html"))
