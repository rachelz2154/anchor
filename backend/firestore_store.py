import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from google.cloud import firestore
from google.auth import default as default_credentials
from google.oauth2 import service_account


class FirestoreConfigError(RuntimeError):
    pass


class FirestoreRequestError(RuntimeError):
    pass


_client: firestore.Client | None = None


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def get_client() -> firestore.Client:
    global _client
    if _client:
        return _client

    try:
        credentials_path = os.getenv("GOOGLE_APPLICATION_CREDENTIALS", "firebase-key.json")
        database = os.getenv("FIRESTORE_DATABASE_ID", "(default)").strip() or "(default)"
        key_path = Path(credentials_path)
        if not key_path.is_absolute():
            key_path = Path(__file__).parent.parent / key_path
        if key_path.exists():
            credentials = service_account.Credentials.from_service_account_file(str(key_path))
            project_id = credentials.project_id
        else:
            credentials, project_id = default_credentials()
        _client = firestore.Client(project=project_id, credentials=credentials, database=database)
    except Exception as exc:
        raise FirestoreConfigError(f"Unable to initialize Firestore client: {exc}") from exc
    return _client


def firestore_status() -> dict[str, Any]:
    client = get_client()
    return {"projectId": client.project, "database": client._database, "credentials": "service-account"}


def _clean_data(data: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in data.items() if value is not None}


def set_current_session(session: dict[str, Any]) -> None:
    try:
        get_client().collection("sessions").document("current").set(
            _clean_data({**session, "updatedAt": now_iso()}),
            merge=True,
        )
    except Exception as exc:
        raise FirestoreRequestError(f"Failed to write current session: {exc}") from exc


def get_current_session() -> dict[str, Any] | None:
    try:
        snapshot = get_client().collection("sessions").document("current").get()
    except Exception as exc:
        raise FirestoreRequestError(f"Failed to read current session: {exc}") from exc
    if not snapshot.exists:
        return None
    return snapshot.to_dict()


def create_live_signal(data: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    return _create_document("liveSignals", data)


def create_tab_snapshot(data: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    return _create_document("tabSnapshots", data)


def create_message(data: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    return _create_document("messages", data)


def _create_document(collection: str, data: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    doc_id = f"{int(time.time() * 1000)}"
    document = _clean_data({**data, "createdAt": now_iso()})
    try:
        get_client().collection(collection).document(doc_id).set(document)
    except Exception as exc:
        raise FirestoreRequestError(f"Failed to write {collection}: {exc}") from exc
    return doc_id, document


def get_latest_message() -> dict[str, Any] | None:
    rows = _run_collection_query("messages", limit=1)
    return rows[0] if rows else None


def get_recent_live_signals(limit: int = 80) -> list[dict[str, Any]]:
    return _run_collection_query("liveSignals", limit=limit)


def _run_collection_query(collection: str, limit: int) -> list[dict[str, Any]]:
    try:
        query = (
            get_client()
            .collection(collection)
            .order_by("createdAt", direction=firestore.Query.DESCENDING)
            .limit(limit)
        )
        rows = []
        for snapshot in query.stream():
            row = snapshot.to_dict()
            row["id"] = snapshot.id
            rows.append(row)
        return rows
    except Exception as exc:
        raise FirestoreRequestError(f"Failed to read {collection}: {exc}") from exc
