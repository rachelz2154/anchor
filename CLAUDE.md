# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Anchor is an ambient agent that detects likely behavioral drift during a declared focus window using device, motion, time, and proximity signals — then delivers a low-friction decision checkpoint through smart glasses (Even G2): “On purpose?”

The agentic brain nudges users at the *moment* of drift — not retrospectively — forcing a conscious choice rather than automatic task-switching.

Even Realities SDK docs: https://hub.evenrealities.com/docs/guides/device-apis

## Setup

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt --index-url https://pypi.org/simple/
cp .env.example .env   # then add ANTHROPIC_API_KEY
```

Chrome extension: load `extension/` as an unpacked extension in `chrome://extensions` (Developer mode on).

## Commands

- Run agent + dashboard: `uvicorn backend.main:app --reload`
- Dashboard: http://localhost:8000
- Simulate an event: `curl -X POST http://localhost:8000/events -H "Content-Type: application/json" -d '{"source":"simulator","type":"tab_change","payload":{"domain":"reddit.com","duration_sec":180}}'`

## Architecture

Conceptual data flow:

```
[Even G2 Smart Glasses]
  → device, motion, time, proximity signals
[Ambient Agent / Drift Detection]
  → detects unconscious task switching
[Decision Checkpoint on Glasses]
  → “On purpose?” — forces a conscious choice
[Logging / State]
  → records user response, updates focus model
```

Key layers to build:
- **Signal ingestion** — Even Realities SDK, device/motion/proximity events
- **Drift detection** — agentic logic that decides when to intervene
- **Intervention delivery** — push checkpoint prompt to glasses
- **Session state** — tracks declared focus window and drift history

## Ignore

Do NOT index or read: `node_modules`, `.venv`, `backend/generated`, `package-lock.json`
