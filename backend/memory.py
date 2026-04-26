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
    return (
        f"{domain} during '{intent}' ({mode} mode): "
        f"drift {drift_pct}% of the time ({row['total_checks']} past sessions)"
    )


def record_response(domain: str, intent: str, mode: str, response: str):
    continued = 1 if response == "continue" else 0
    switched = 1 if response == "switch" else 0
    conn = get_conn()
    conn.execute(
        """
        INSERT INTO domain_memory (domain, intent_type, mode, total_checks, continued_count, switched_count)
        VALUES (?, ?, ?, 1, ?, ?)
        ON CONFLICT(domain, intent_type, mode) DO UPDATE SET
            total_checks    = total_checks + 1,
            continued_count = continued_count + ?,
            switched_count  = switched_count  + ?
        """,
        (domain, intent, mode, continued, switched, continued, switched),
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
