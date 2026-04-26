import json

from anthropic import Anthropic

client = Anthropic()

MODE_INSTRUCTIONS = {
    "light": (
        "The user is in LIGHT mode — gentle focus, reasonable digressions are fine. "
        "Only flag clear, prolonged drift (e.g. entertainment sites for 5+ minutes)."
    ),
    "deep": (
        "The user is in DEEP WORK mode — standard focus. "
        "Flag context drift after a couple of minutes off-task."
    ),
    "locked": (
        "The user is in LOCKED IN mode — maximum focus, zero tolerance. "
        "Flag any off-task activity immediately and be strict. "
        "Do not give benefit of the doubt."
    ),
}


def _summarise_events(events: list[dict]) -> str:
    if not events:
        return "No recent activity recorded."
    lines = []
    for e in events:
        payload = json.loads(e["payload"]) if isinstance(e["payload"], str) else e["payload"]
        if e["type"] == "tab_change":
            lines.append(
                f"  Browser tab: {payload.get('domain', 'unknown')} "
                f"— {payload.get('duration_sec', 0):.0f}s"
            )
        elif e["type"] == "accel_snapshot":
            lines.append(f"  Motion/posture: {payload.get('summary', 'no data')}")
        elif e["type"] == "idle":
            lines.append(f"  Input idle: {payload.get('duration_sec', 0):.0f}s")
        elif e["type"] == "app_switch":
            lines.append(f"  App switch: {payload.get('from', '?')} → {payload.get('to', '?')}")
    return "\n".join(lines)


def check_drift(session: dict, recent_events: list[dict], memory_hint: str) -> dict:
    mode = session.get("mode", "deep")
    activity = _summarise_events(recent_events)

    prompt = f"""You are Anchor, an ambient focus agent. Detect whether the user has drifted from their declared intent.

Declared intent: "{session['intent']}"
Focus mode: {mode.upper()}
{MODE_INSTRUCTIONS[mode]}

Recent activity (last 5 min):
{activity}

Memory context (past behaviour on this domain):
{memory_hint or "No historical data yet."}

Accelerometer note: if motion data shows prolonged stillness with head-down posture during off-task browsing, weight that as a stronger drift signal.

Reply ONLY with valid JSON — no prose, no markdown:
{{
  "is_drift": true | false,
  "confidence": 0.0–1.0,
  "reasoning": "one concise sentence",
  "send_checkpoint": true | false,
  "checkpoint_message": "short message for glasses (max 10 words)"
}}"""

    response = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=300,
        messages=[{"role": "user", "content": prompt}],
    )

    return json.loads(response.content[0].text.strip())
