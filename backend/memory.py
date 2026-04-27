from .database import get_conn


def get_memory_hint(domain: str, intent: str, mode: str) -> str:
    conn = get_conn()
    row = conn.execute(
        "SELECT * FROM domain_memory WHERE domain=? AND intent_type=? AND mode=?",
        (domain, intent, mode),
    ).fetchone()
    conn.close()

    if not row or row["total_checks"] == 0:
        return ""

    drift_pct = int((row["switched_count"] / row["total_checks"]) * 100)
    relevance_note = f", typically classified as '{row['last_relevance']}'" if row["last_relevance"] else ""
    return (
        f"{domain} during '{intent}' ({mode} mode): "
        f"drift {drift_pct}% of the time ({row['total_checks']} past sessions{relevance_note})"
    )


def record_response(domain: str, intent: str, mode: str, response: str, relevance: str | None = None):
    continued = 1 if response == "continue" else 0
    switched = 1 if response == "switch" else 0
    conn = get_conn()
    conn.execute(
        """
        INSERT INTO domain_memory (domain, intent_type, mode, total_checks, continued_count, switched_count, last_relevance)
        VALUES (?, ?, ?, 1, ?, ?, ?)
        ON CONFLICT(domain, intent_type, mode) DO UPDATE SET
            total_checks    = total_checks + 1,
            continued_count = continued_count + ?,
            switched_count  = switched_count  + ?,
            last_relevance  = COALESCE(?, last_relevance)
        """,
        (domain, intent, mode, continued, switched, relevance, continued, switched, relevance),
    )
    conn.commit()
    conn.close()


def update_relevance(domain: str, intent: str, mode: str, relevance: str):
    """Update domain relevance classification from LLM signal tagging."""
    conn = get_conn()
    conn.execute(
        """
        INSERT INTO domain_memory (domain, intent_type, mode, total_checks, last_relevance)
        VALUES (?, ?, ?, 0, ?)
        ON CONFLICT(domain, intent_type, mode) DO UPDATE SET
            last_relevance = ?
        """,
        (domain, intent, mode, relevance, relevance),
    )
    conn.commit()
    conn.close()


def get_all_memory() -> list[dict]:
    conn = get_conn()
    rows = conn.execute(
        "SELECT * FROM domain_memory ORDER BY total_checks DESC"
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_metrics() -> dict:
    conn = get_conn()

    # Overall checkpoint stats
    row = conn.execute("""
        SELECT
            COUNT(dc.id)                                                        AS total_checks,
            SUM(dc.sent_to_glasses)                                             AS total_fired,
            SUM(CASE WHEN cr.response = 'switch'   THEN 1 ELSE 0 END)          AS confirmed_drift,
            SUM(CASE WHEN cr.response = 'continue' THEN 1 ELSE 0 END)          AS false_alarms,
            SUM(CASE WHEN cr.response = 'ignored'  THEN 1 ELSE 0 END)          AS ignored,
            ROUND(AVG(dc.confidence) * 100)                                     AS avg_confidence_pct
        FROM drift_checks dc
        LEFT JOIN checkpoint_responses cr ON cr.drift_check_id = dc.id
    """).fetchone()

    total_fired = row["total_fired"] or 0
    confirmed = row["confirmed_drift"] or 0
    false_alarms = row["false_alarms"] or 0
    # Only count explicit responses (continue/switch) — ignored = no signal
    responded = confirmed + false_alarms
    precision = round((confirmed / responded * 100)) if responded > 0 else None
    false_alarm_rate = round((false_alarms / responded * 100)) if responded > 0 else None

    # Relevance breakdown across memory
    relevance_rows = conn.execute("""
        SELECT last_relevance, COUNT(*) as count
        FROM domain_memory
        WHERE last_relevance IS NOT NULL
        GROUP BY last_relevance
    """).fetchall()
    relevance_dist = {r["last_relevance"]: r["count"] for r in relevance_rows}

    conn.close()

    return {
        "total_checks": row["total_checks"] or 0,
        "total_fired": total_fired,
        "confirmed_drift": confirmed,
        "false_alarms": false_alarms,
        "ignored": row["ignored"] or 0,
        "precision_pct": precision,
        "false_alarm_rate_pct": false_alarm_rate,
        "avg_confidence_pct": row["avg_confidence_pct"],
        "relevance_distribution": relevance_dist,
    }
