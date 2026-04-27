import asyncio
import base64
import json
import logging
import os
import tempfile
import urllib.error
import urllib.request
import wave
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")

from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi import HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

load_dotenv()

from .agent import broadcast, get_active_session, set_queue
from .database import get_conn, init_db
from .firestore_agent import latest_message, run_focus_check_once, firestore_focus_loop
from .firestore_store import (
    FirestoreConfigError,
    FirestoreRequestError,
    create_live_signal,
    create_tab_snapshot,
    firestore_status,
    set_current_session,
)
from .memory import get_all_memory, get_metrics, record_response

_broadcast_queue: asyncio.Queue = asyncio.Queue()
_clients: list[WebSocket] = []

FRONTEND_DIR = Path(__file__).parent.parent / "frontend"


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    set_queue(_broadcast_queue)
    asyncio.create_task(firestore_focus_loop(broadcast))
    asyncio.create_task(_broadcaster())
    yield


app = FastAPI(title="Anchor", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


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


class FirestoreDocumentBody(BaseModel):
    data: dict


class VoiceTranscriptionBody(BaseModel):
    pcm_base64: str
    sample_rate: int = 16000


# ── Routes ────────────────────────────────────────────────────────────────────

def _pcm_to_wav_bytes(pcm: bytes, sample_rate: int) -> bytes:
    with tempfile.TemporaryFile() as wav_file:
        with wave.open(wav_file, "wb") as writer:
            writer.setnchannels(1)
            writer.setsampwidth(2)
            writer.setframerate(sample_rate)
            writer.writeframes(pcm)
        wav_file.seek(0)
        return wav_file.read()


def _multipart_body(fields: dict[str, str], files: dict[str, tuple[str, str, bytes]]) -> tuple[bytes, str]:
    boundary = "anchor-whisper-boundary"
    parts: list[bytes] = []
    for name, value in fields.items():
        parts.append(
            (
                f"--{boundary}\r\n"
                f'Content-Disposition: form-data; name="{name}"\r\n\r\n'
                f"{value}\r\n"
            ).encode("utf-8")
        )
    for name, (filename, content_type, data) in files.items():
        parts.append(
            (
                f"--{boundary}\r\n"
                f'Content-Disposition: form-data; name="{name}"; filename="{filename}"\r\n'
                f"Content-Type: {content_type}\r\n\r\n"
            ).encode("utf-8")
            + data
            + b"\r\n"
        )
    parts.append(f"--{boundary}--\r\n".encode("utf-8"))
    return b"".join(parts), boundary


def _transcribe_with_whisper(wav_bytes: bytes) -> str:
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=503, detail="OPENAI_API_KEY is not configured")

    body, boundary = _multipart_body(
        {"model": "whisper-1", "response_format": "json"},
        {"file": ("anchor.wav", "audio/wav", wav_bytes)},
    )
    request = urllib.request.Request(
        "https://api.openai.com/v1/audio/transcriptions",
        data=body,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise HTTPException(status_code=502, detail=detail) from exc
    except urllib.error.URLError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    text = payload.get("text", "")
    return text if isinstance(text, str) else ""


@app.post("/voice/transcribe")
async def voice_transcribe(body: VoiceTranscriptionBody):
    try:
        pcm = base64.b64decode(body.pcm_base64, validate=True)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid PCM payload") from exc
    if not pcm:
        raise HTTPException(status_code=400, detail="Empty PCM payload")
    wav_bytes = _pcm_to_wav_bytes(pcm, body.sample_rate)
    text = await asyncio.to_thread(_transcribe_with_whisper, wav_bytes)
    return {"text": text}

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
    session_doc = {
        "active": True,
        "sessionId": session_id,
        "intent": body.intent,
        "mode": body.mode,
        "startedAt": datetime.now().isoformat(),
        "source": "anchor-dashboard",
    }
    try:
        set_current_session(session_doc)
    except (FirestoreConfigError, FirestoreRequestError) as exc:
        await broadcast({"type": "agent_error", "message": str(exc)})
        raise HTTPException(status_code=503, detail=str(exc)) from exc
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
    try:
        set_current_session({"active": False, "endedAt": datetime.now().isoformat(), "source": "anchor-dashboard"})
    except (FirestoreConfigError, FirestoreRequestError) as exc:
        await broadcast({"type": "agent_error", "message": str(exc)})
        raise HTTPException(status_code=503, detail=str(exc)) from exc
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
    payload = dict(body.payload)
    firestore_signal = {
        "source": body.source,
        "type": body.type,
        **payload,
        "sessionId": session["id"],
        "sessionIntent": session["intent"],
        "sessionMode": session["mode"],
    }
    try:
        create_live_signal(firestore_signal)
    except (FirestoreConfigError, FirestoreRequestError) as exc:
        await broadcast({"type": "agent_error", "message": str(exc)})
    conn = get_conn()
    conn.execute(
        "INSERT INTO activity_events (session_id, timestamp, source, type, payload) VALUES (?,?,?,?,?)",
        (session["id"], datetime.now().isoformat(), body.source, body.type, json.dumps(payload)),
    )
    conn.commit()
    conn.close()
    await broadcast({"type": "new_event", "source": body.source, "event_type": body.type, "payload": payload})
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


@app.get("/metrics")
async def metrics():
    return get_metrics()


@app.get("/firebase-config")
async def firebase_config():
    try:
        return firestore_status()
    except FirestoreConfigError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.post("/firestore/live-signal")
async def firestore_live_signal(body: FirestoreDocumentBody):
    try:
        signal_id, signal = create_live_signal(body.data)
    except (FirestoreConfigError, FirestoreRequestError) as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    await broadcast({
        "type": "new_event",
        "source": signal.get("source", "chrome"),
        "event_type": signal.get("type", "tab_change"),
        "payload": signal,
    })
    return {"id": signal_id, **signal}


@app.post("/firestore/tab-snapshot")
async def firestore_tab_snapshot(body: FirestoreDocumentBody):
    try:
        snapshot_id, snapshot = create_tab_snapshot(body.data)
    except (FirestoreConfigError, FirestoreRequestError) as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return {"id": snapshot_id, **snapshot}


@app.get("/messages/latest")
async def messages_latest():
    try:
        return latest_message() or {}
    except (FirestoreConfigError, FirestoreRequestError) as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.post("/messages/clear")
async def messages_clear():
    await broadcast({"type": "focus_message", "message": {}})
    return {"ok": True}


@app.post("/agent/check-now")
async def agent_check_now():
    try:
        message = await run_focus_check_once()
    except (FirestoreConfigError, FirestoreRequestError, ValueError, KeyError, Exception) as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if message:
        await broadcast({"type": "focus_message", "message": message})
        return message
    return {"ok": True, "reason": "no active session or no focus change"}


# ── WebSocket ─────────────────────────────────────────────────────────────────

@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    await ws.accept()
    _clients.append(ws)
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
