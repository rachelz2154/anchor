# Anchor — On Purpose?

An ambient focus agent for Even G2 smart glasses that detects unconscious task switching and delivers a real-time decision checkpoint: **"On purpose?"**

> You set the direction. We catch the drift.

## How it works

```
[Chrome Extension / Even G2 Accelerometer]
  → streams tab activity + motion signals
[Agent Loop (Claude)]
  → reasons over activity window every 30s
  → detects drift from declared intent
[Checkpoint on Glasses + Dashboard]
  → "On purpose?" — continue or switch intentionally
[Memory Layer]
  → learns your drift patterns over time, gets smarter
```

Focus modes: **Light** (5 min threshold) · **Deep Work** (2 min) · **Locked In** (30 sec)

---

## Requirements

- Python 3.11+
- Node.js 18+ (for the Even G2 glasses app)
- An `ANTHROPIC_API_KEY`
- Even Realities G2 glasses or simulator (optional for hardware demo)
- Chrome (for the browser extension)

---

## Setup

### 1. Clone and set up Python environment

```bash
git clone https://github.com/rachelz2154/anchor.git
cd anchor
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt --index-url https://pypi.org/simple/
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env and add your ANTHROPIC_API_KEY
```

### 3. Start the agent + dashboard

```bash
uvicorn backend.main:app --reload
```

Open **http://localhost:8000** — you'll see the live dashboard.

### 4. Load the Chrome extension

1. Go to `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** → select the `extension/` folder

Tab activity will now stream automatically to the agent when a session is active.

---

## Running a demo

**Start a focus session** — type your intent (e.g. `"Building auth flow"`) in the dashboard, pick a mode, click **Start Session**.

**Run test scenarios** to trigger the LLM without waiting for real drift:

```bash
bash scripts/test_scenarios.sh drift      # Reddit rabbit hole — expect checkpoint
bash scripts/test_scenarios.sh research   # Stack Overflow + docs — expect ON TRACK
bash scripts/test_scenarios.sh ambiguous  # Gmail + Slack — watch LLM reason it out
bash scripts/test_scenarios.sh phone      # Phone pickup via accelerometer only
bash scripts/test_scenarios.sh memory     # Run after drift + "Switch task" to show memory
bash scripts/test_scenarios.sh mode_demo  # Same signals across all three modes
```

Wait ~30 seconds after each scenario for the agent loop to pick up the signals and call Claude.

**Respond to checkpoints** — a popup appears on the dashboard (simulating the glasses display). Click **Continue focus** or **Switch task**. It auto-dismisses after 60s as "ignored".

Watch the **Memory Layer** table populate as the agent learns your drift patterns.

---

## Even G2 glasses app

The `src/` directory contains the Even Hub app that renders checkpoints on the glasses.

```bash
npm install
npm run dev          # dev server
npm run simulate     # Even simulator
npm run pack         # builds anchor-hello-world.ehpk for device deployment
```

Load on hardware with a QR code:

```bash
npx evenhub qr --url "http://YOUR_LAN_IP:5173"
```

Even Realities SDK docs: https://hub.evenrealities.com/docs/guides/device-apis

---

## Project structure

```
backend/        FastAPI agent — database, reasoning (Claude), memory, agent loop
frontend/       Dashboard — live signals, reasoning history, memory table
extension/      Chrome extension — tab activity → agent
scripts/        Test scenario scripts for demo
src/            Even G2 glasses app (TypeScript / Even Hub SDK)
```

---

## Architecture notes

- The agent loop runs every 30s, assembles a 5-minute activity window, and calls Claude with the session intent + mode + memory context
- Accelerometer data from the glasses feeds the LLM as a natural language summary (e.g. "head still, downward tilt — consistent with phone scroll")
- The memory layer stores `domain × intent × mode → drift rate` and feeds that into the prompt so the agent personalises thresholds over time
- A 5-minute cooldown prevents checkpoint spam after one fires
