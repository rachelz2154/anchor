import asyncio
import os
from datetime import datetime, timedelta, timezone
from typing import Any

from .firestore_store import (
    FirestoreConfigError,
    FirestoreRequestError,
    create_message,
    get_current_session,
    get_latest_message,
    get_recent_live_signals,
)
from .reasoning import check_user_on_track


CHECK_INTERVAL_SECONDS = int(os.getenv("FIRESTORE_CHECK_INTERVAL_SECONDS", "15"))
SIGNAL_WINDOW_SECONDS = int(os.getenv("FOCUS_SIGNAL_WINDOW_SECONDS", "120"))
_last_check_key: tuple[Any, ...] | None = None
_last_signal_cutoff_at: datetime | None = None
_last_session_key: tuple[Any, ...] | None = None


def _parse_time(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc)
    if not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)
    except ValueError:
        return None


def _session_signal_matches(session: dict[str, Any], signal: dict[str, Any]) -> bool:
    session_id = session.get("sessionId")
    if session_id is None:
        return True
    return str(signal.get("sessionId", "")) == str(session_id)


def _signal_is_fresh(signal: dict[str, Any]) -> bool:
    created_at = _parse_time(signal.get("createdAt"))
    if not created_at:
        return False
    return created_at >= datetime.now(timezone.utc) - timedelta(seconds=SIGNAL_WINDOW_SECONDS)


def _signal_is_after_cutoff(signal: dict[str, Any], cutoff: datetime) -> bool:
    created_at = _parse_time(signal.get("createdAt"))
    if not created_at:
        return False
    return created_at > cutoff


async def run_focus_check_once() -> dict[str, Any] | None:
    global _last_check_key, _last_signal_cutoff_at, _last_session_key
    session = get_current_session()
    if not session or not session.get("active"):
        _last_check_key = None
        _last_signal_cutoff_at = None
        _last_session_key = None
        return None

    now = datetime.now(timezone.utc)
    session_key = (session.get("sessionId"), session.get("intent"), session.get("mode"))
    if session_key != _last_session_key:
        _last_check_key = None
        _last_signal_cutoff_at = now - timedelta(seconds=CHECK_INTERVAL_SECONDS)
        _last_session_key = session_key

    cutoff = _last_signal_cutoff_at or now - timedelta(seconds=CHECK_INTERVAL_SECONDS)
    signals = [
        signal
        for signal in get_recent_live_signals()
        if (
            _session_signal_matches(session, signal)
            and _signal_is_fresh(signal)
            and _signal_is_after_cutoff(signal, cutoff)
        )
    ]
    _last_signal_cutoff_at = now
    if not signals:
        _last_check_key = None
        return None

    signal_fingerprint = tuple(
        (
            signal.get("id"),
            signal.get("createdAt"),
            signal.get("type"),
            signal.get("domain"),
            signal.get("durationSec", signal.get("duration_sec")),
        )
        for signal in signals[:10]
    )
    check_key = (session.get("sessionId"), session.get("intent"), session.get("mode"), signal_fingerprint)
    if check_key == _last_check_key:
        return None
    _last_check_key = check_key
    try:
        result = await asyncio.to_thread(check_user_on_track, session, signals)
        user_on_track = bool(result["userOnTrack"])
        message_text = str(result["message"])
        status = "ok"
    except Exception as exc:
        user_on_track = False
        message_text = f"Focus check unavailable: {exc}"
        status = "llm_error"
    message_data = {
        "userOnTrack": user_on_track,
        "message": message_text,
        "status": status,
        "sessionId": session.get("sessionId"),
        "sessionIntent": session.get("intent", ""),
        "sessionMode": session.get("mode", "deep"),
        "signalCount": len(signals),
    }
    message_id, message = create_message(message_data)
    return {"id": message_id, **message}


async def firestore_focus_loop(broadcast):
    while True:
        await asyncio.sleep(CHECK_INTERVAL_SECONDS)
        try:
            message = await run_focus_check_once()
            if message:
                await broadcast({"type": "focus_message", "message": message})
        except FirestoreConfigError as exc:
            await broadcast({"type": "agent_error", "message": str(exc)})
        except (FirestoreRequestError, ValueError, KeyError, Exception) as exc:
            await broadcast({"type": "agent_error", "message": str(exc)})


def latest_message() -> dict[str, Any] | None:
    return get_latest_message()
