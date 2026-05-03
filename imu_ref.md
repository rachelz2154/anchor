▎ For Anchor's LLM/backend side: how the IMU drift signal works
▎
▎ The plugin already does first-pass distraction detection on the glasses and POSTs the result to ${ANCHOR_API_ORIGIN}/events (backend/main.py). You don't need to compute energy yourself — but you need to know what the numbers mean to use them in the LLM prompt.
▎
▎ Payload shape (per event):
▎ {
▎   "source": "g2",
▎   "type": "motion",
▎   "payload": {
▎     "summary": "Focus; head still; motion energy 0.01, moving 12%",
▎     "mode": "Focus" | "Distracted",
▎     "energy": 0.012,
▎     "movingFrac": 0.12,
▎     "possibleHeadDown": false,
▎     "headDownSeconds": 0.0,
▎     "x": 0.02, "y": -0.98, "z": 0.05
▎   }
▎ }
▎
▎ The formula (so you can tune the right knob):
▎
▎ 1. IMU streams at 10 Hz from the glasses (ImuReportPace.P100).
▎ 2. Per sample, compute energy: energy = sqrt(dx² + dy² + dz²) where dx = x - x_prev, etc. Energy is the magnitude of the change in acceleration between two consecutive samples — a scalar "how much motion just happened".
▎ 3. Maintain a rolling 60-second window of those energies.
▎ 4. Count samples where energy > STILL_THRESHOLD (0.02) — those are "moving" samples.
▎ 5. movingFrac = movingCount / totalSamples.
▎ 6. If movingFrac > 0.7 (i.e. user was moving for >70% of the last minute), mode = 'Distracted'. Otherwise 'Focus'.
▎
▎ What this means for your LLM prompt:
▎
▎ - mode === 'Distracted' is the plugin's verdict — you can treat it as "the user has been physically active for >42 of the last 60 seconds". Common interpretations: stood up, walked to bathroom, paced during a call, fidgeted heavily.
▎ - mode === 'Focus' means the user has been mostly still — head settled, probably at desk. (NB: also true if they fell asleep. Don't assume "Focus" means "productive".)
▎ - energy instantaneous: spike of >0.1 is a sudden head movement (looking up, stand-up onset). Use for "moment of drift" signals.
▎ - movingFrac: continuous version of mode. Useful if you want soft thresholds in the LLM prompt (e.g. "head was active 45% of the last minute" reads better to Claude than a binary).
▎ - possibleHeadDown / headDownSeconds: a separate signal — user's head has been tilted down for N seconds, suggesting phone or notebook posture. Fires before motion energy does.
▎
▎ What you need to do on the backend:
▎
▎ 1. Ingest the /events POST and store the payload alongside the Chrome extension tab events. Same agent window.
▎ 2. Aggregate during the 30s agent loop. Recommended summary fields for the LLM:
▎   - latest mode and movingFrac
▎   - count of mode === 'Distracted' events in the last 5 minutes
▎   - max headDownSeconds in window
▎   - any energy > 0.1 spikes (count + timestamps)
▎ 3. Feed natural language to Claude — per CLAUDE.md, the agent loop already does this for tab data. Add a one-liner like:
▎ ▎ "Glasses motion: head still for the last 4 minutes, then sustained movement for the last 65 seconds (Distracted, 78% moving, energy peaked at 0.34)."
▎ ▎ Or for ON TRACK cases:
▎ ▎ "Glasses motion: head still throughout (Focus, 8% moving)."
▎ 4. Decide intervention in the existing reasoning step. The plugin's mode flip is suggestive, not authoritative — combine with tab signals before firing "On purpose?". A user could be Distracted because they took a healthy water break, which the LLM should reason about with the rest of the context.
▎
▎ Tuning knobs (in src/main.ts:706-710):
▎
▎ | Constant            | Now    | Effect                                                                                             |
▎ |---------------------|--------|----------------------------------------------------------------------------------------------------|
▎ | STILL_THRESHOLD     | 0.02   | Lower = more sensitive (counts smaller motion as "moving"). Calibrated against real glasses today. |
▎ | WINDOW_MS           | 60_000 | Longer = slower to flip mode, more stable. 30s would feel snappier in demo.                        |
▎ | MOVING_FRAC_TRIGGER | 0.7    | Higher = needs sustained movement; lower = trigger-happy.                                          |
▎ | MIN_SAMPLES         | 30     | Suppresses mode flips during the first ~3s of warmup.                                              |
▎
▎ Important: the plugin runs the heuristic at 10 Hz but throttles /events POSTs. You'll typically get ~1 event/sec, not 10. Check imuSignalPostInFlight logic in src/main.ts:373 if you want to change cadence.
▎
▎ Two open issues that bite on the LLM side:
▎
▎ 1. No baseline-per-user yet. A jittery person at rest might score movingFrac = 0.3 while a still person scores 0.05. Same threshold treats them differently. Memory layer (backend/memory.py) could store per-user baselines and adjust the prompt accordingly.
▎ 2. The 60s window means slow recovery. User stops moving → it takes ~40-60s before mode flips back to Focus. If you fire "On purpose?" right at the flip, the user might already be back at the desk. Consider a 5-10s grace window after mode flips before triggering.
▎
▎ SDK / sensor reference is in docs/sensor-inventory.md and docs/even-realities-sdk.md.