import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent.parent / "anchor.db"


def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_conn()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS focus_sessions (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            intent      TEXT    NOT NULL,
            mode        TEXT    NOT NULL DEFAULT 'deep',
            started_at  TEXT    NOT NULL,
            ended_at    TEXT,
            active      INTEGER NOT NULL DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS activity_events (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id  INTEGER,
            timestamp   TEXT    NOT NULL,
            source      TEXT    NOT NULL,
            type        TEXT    NOT NULL,
            payload     TEXT    NOT NULL
        );

        CREATE TABLE IF NOT EXISTS drift_checks (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id      INTEGER NOT NULL,
            triggered_at    TEXT    NOT NULL,
            reasoning       TEXT    NOT NULL,
            confidence      REAL    NOT NULL,
            is_drift        INTEGER NOT NULL,
            sent_to_glasses INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS checkpoint_responses (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            drift_check_id  INTEGER NOT NULL,
            response        TEXT    NOT NULL,
            responded_at    TEXT    NOT NULL
        );

        CREATE TABLE IF NOT EXISTS domain_memory (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            domain          TEXT    NOT NULL,
            intent_type     TEXT    NOT NULL,
            mode            TEXT    NOT NULL,
            total_checks    INTEGER NOT NULL DEFAULT 0,
            continued_count INTEGER NOT NULL DEFAULT 0,
            switched_count  INTEGER NOT NULL DEFAULT 0,
            UNIQUE(domain, intent_type, mode)
        );
    """)
    conn.commit()
    conn.close()
