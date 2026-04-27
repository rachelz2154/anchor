import json
import os

from anthropic import Anthropic

client = Anthropic()
FOCUS_MODEL = os.getenv("ANTHROPIC_FOCUS_MODEL", "claude-sonnet-4-6")

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
        if e["type"] in {"tab_change", "tab_active"}:
            domain = payload.get("domain", "unknown")
            title = payload.get("title", "").strip()
            path = payload.get("path", "").strip()
            duration = int(payload.get("duration_sec", 0))

            summary = payload.get("summary", "").strip()
            detail = domain
            if path and path not in ("/", ""):
                detail += path[:80]
            if title:
                detail += f' — "{title[:100]}"'
            if summary and summary not in (title, ""):
                detail += f' | {summary[:160]}'

            lines.append(f"  Browser: {detail} ({duration}s)")
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
Use a friendly, therapeutic tone. Be warm, non-shaming, and autonomy-preserving.
Avoid scolding, commands, or phrases like "stay off", "should", "must", or "get back".
Frame drift as neutral noticing and invite an intentional choice.

Declared intent: "{session['intent']}"
Focus mode: {mode.upper()}
{MODE_INSTRUCTIONS[mode]}

Recent activity (last 5 min):
{activity}

Memory context (past behaviour on this domain):
{memory_hint or "No historical data yet."}

Accelerometer note: if motion data shows prolonged stillness with head-down posture during off-task browsing, weight that as a stronger drift signal.

For each browser tab domain in the activity above, classify its relevance to the declared intent:
- "context_related": clearly supports the intent (e.g. docs, GitHub, Stack Overflow during coding)
- "ambiguous": could be work or distraction (e.g. email, Slack)
- "off_task": no plausible connection to the intent (e.g. Reddit, Twitter, YouTube)

Reply ONLY with valid JSON — no prose, no markdown:
{{
  "is_drift": true | false,
  "confidence": 0.0–1.0,
  "reasoning": "one concise sentence",
  "send_checkpoint": true | false,
  "checkpoint_message": "warm checkpoint for glasses (max 10 words)",
  "signal_relevance": [{{"domain": "example.com", "relevance": "context_related|ambiguous|off_task"}}]
}}

Note: confidence means certainty in your assessment — high confidence when signals clearly point one way (either clearly on-track OR clearly drifting). Low confidence when signals are ambiguous. A definitive ON TRACK verdict with strong evidence should score 0.8–0.95, same as a definitive DRIFT verdict."""

    response = client.messages.create(
        model=FOCUS_MODEL,
        max_tokens=512,
        messages=[{"role": "user", "content": prompt}],
    )

    raw = response.content[0].text.strip()

    # Strip markdown code fences if the model wrapped the JSON
    if raw.startswith("```"):
        raw = raw.split("```", 2)[1]
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.strip()

    return json.loads(raw)


def check_user_on_track(session: dict, signals: list[dict]) -> dict:
    intent = session.get("intent", "")
    mode = session.get("mode", "deep")
    signal_lines = []
    for signal in signals[:30]:
        created_at = signal.get("createdAt", "")
        signal_type = signal.get("type", "tab_change")
        if signal_type == "accel_snapshot":
            summary = signal.get("summary", "motion data")
            signal_lines.append(f"- {created_at}: glasses motion {summary}".strip())
        else:
            domain = signal.get("domain", "unknown")
            duration = signal.get("durationSec", signal.get("duration_sec", 0))
            title = signal.get("title", "")
            signal_lines.append(f"- {created_at}: {signal_type} {domain} for {duration}s {title}".strip())

    activity = "\n".join(signal_lines) or "No browser signals were recorded in the latest window."
    response = client.messages.create(
        model=FOCUS_MODEL,
        max_tokens=250,
        tools=[
            {
                "name": "record_focus_status",
                "description": "Record whether the user is on track for their declared focus session.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "userOnTrack": {
                            "type": "boolean",
                            "description": "True when the recent browser activity matches the stated intent.",
                        },
                        "message": {
                            "type": "string",
                            "description": "One short sentence explaining the decision to display in Anchor.",
                        },
                    },
                    "required": ["userOnTrack", "message"],
                    "additionalProperties": False,
                },
            }
        ],
        tool_choice={"type": "tool", "name": "record_focus_status"},
        messages=[
            {
                "role": "user",
                "content": f"""You are Anchor, a gentle focus companion.
Your job is to notice drift without judgment and help the user make a conscious choice.

Tone rules:
- Be friendly, calm, and therapeutic.
- Do not shame, scold, or command the user.
- Avoid phrases like "stay off", "stop", "should", "must", or "return to".
- Prefer soft language like "Looks like...", "Maybe...", "Want to...", "No judgment...", "Take a breath...".
- If the user is off track, make the message supportive and choice-oriented.
- If glasses motion reports possible head-down/phone posture for 10+ seconds, gently ask:
  "Hey, are you looking at your phone or something?"
- Keep the message short enough for a tiny glasses display.

The user's current focus intent is: "{intent}"
Focus mode: {mode}

Recent browser signals:
{activity}

Decide whether the recent activity appears aligned with the user's stated focus. Use the tool with exactly:
userOnTrack: boolean
message: one short, kind sentence for Anchor. If off track, avoid commands and invite an intentional choice.""",
            }
        ],
    )

    for block in response.content:
        if getattr(block, "type", None) == "tool_use":
            return dict(block.input)
    raise ValueError("Structured focus status response was not returned")
