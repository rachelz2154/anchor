import asyncio
import json
import logging
from datetime import datetime, timedelta

log = logging.getLogger("anchor.agent")

from .database import get_conn
from .memory import get_memory_hint, update_relevance
from .reasoning import check_drift

# Seconds of off-task time before the agent fires a check per mode
MODE_IDLE_THRESHOLDS = {
    "light": 300,
    "deep": 120,
    "locked": 30,
}

# Cooldown: don't fire another checkpoint within this many seconds of the last one
CHECKPOINT_COOLDOWN_SEC = 300  # 5 minutes

_broadcast_queue: asyncio.Queue | None = None
connected_clients: list = []
_last_checkpoint_at: datetime | None = None


def set_queue(q: asyncio.Queue):
    global _broadcast_queue
    _broadcast_queue = q


async def broadcast(data: dict):
    if _broadcast_queue:
        await _broadcast_queue.put(data)


# ---------- DB helpers ----------

def get_active_session() -> dict | None:
    conn = get_conn()
    row = conn.execute(
        "SELECT * FROM focus_sessions WHERE active=1 ORDER BY started_at DESC LIMIT 1"
    ).fetchone()
    conn.close()
    return dict(row) if row else None


def get_recent_events(session_id: int, seconds: int = 15) -> list[dict]:
    since = (datetime.now() - timedelta(seconds=seconds)).isoformat()
    conn = get_conn()
    rows = conn.execute(
        "SELECT * FROM activity_events WHERE session_id=? AND timestamp > ? ORDER BY timestamp DESC LIMIT 30",
        (session_id, since),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_current_domain(session_id: int) -> str:
    conn = get_conn()
    row = conn.execute(
        "SELECT payload FROM activity_events WHERE session_id=? AND type='tab_change' ORDER BY timestamp DESC LIMIT 1",
        (session_id,),
    ).fetchone()
    conn.close()
    if row:
        return json.loads(row["payload"]).get("domain", "")
    return ""


def save_drift_check(session_id: int, result: dict) -> int:
    conn = get_conn()
    cursor = conn.execute(
        "INSERT INTO drift_checks (session_id, triggered_at, reasoning, confidence, is_drift, sent_to_glasses) VALUES (?,?,?,?,?,?)",
        (
            session_id,
            datetime.now().isoformat(),
            result["reasoning"],
            result["confidence"],
            1 if result["is_drift"] else 0,
            1 if result.get("send_checkpoint") else 0,
        ),
    )
    drift_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return drift_id


# ---------- Main loop ----------

async def agent_loop():
    """Runs every 30 s, reasons over recent activity, fires checkpoint if drift detected."""
    while True:
        await asyncio.sleep(30)
        try:
            session = get_active_session()
            if not session:
                log.info("agent tick — no active session, skipping")
                continue

            events = get_recent_events(session["id"])
            if not events:
                log.info("agent tick — session '%s' has no recent events, skipping", session["intent"])
                continue

            log.info("agent tick — reasoning over %d events for '%s'", len(events), session["intent"])
            domain = get_current_domain(session["id"])
            memory_hint = get_memory_hint(domain, session["intent"], session["mode"]) if domain else ""

            await broadcast({"type": "agent_thinking", "message": "Analysing activity window…"})

            result = check_drift(session, events, memory_hint)
            log.info("agent result — drift=%s confidence=%.2f", result.get("is_drift"), result.get("confidence"))
            drift_id = save_drift_check(session["id"], result)

            # Persist relevance classifications the LLM produced
            for tag in result.get("signal_relevance", []):
                if tag.get("domain") and tag.get("relevance"):
                    update_relevance(tag["domain"], session["intent"], session["mode"], tag["relevance"])

            await broadcast(
                {
                    "type": "reasoning_update",
                    "drift_check_id": drift_id,
                    "reasoning": result["reasoning"],
                    "confidence": result["confidence"],
                    "is_drift": result["is_drift"],
                    "send_checkpoint": result.get("send_checkpoint", False),
                    "checkpoint_message": result.get("checkpoint_message", ""),
                    "signal_relevance": result.get("signal_relevance", []),
                }
            )

            if result.get("send_checkpoint"):
                global _last_checkpoint_at
                now = datetime.now()
                in_cooldown = (
                    _last_checkpoint_at is not None
                    and (now - _last_checkpoint_at).total_seconds() < CHECKPOINT_COOLDOWN_SEC
                )
                if not in_cooldown:
                    _last_checkpoint_at = now
                    await broadcast(
                        {
                            "type": "checkpoint_fired",
                            "drift_check_id": drift_id,
                            "message": result.get("checkpoint_message", "On purpose?"),
                        }
                    )

        except Exception as exc:
            log.exception("agent loop error: %s", exc)
            await broadcast({"type": "agent_error", "message": str(exc)})
