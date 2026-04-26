#!/usr/bin/env bash
# Anchor test scenarios — run these after starting a session in the dashboard.
# Each scenario feeds realistic signals to trigger (or not trigger) the LLM.
# Usage: bash scripts/test_scenarios.sh <scenario>

BASE="http://localhost:8000"

post_event() {
  curl -s -X POST "$BASE/events" \
    -H "Content-Type: application/json" \
    -d "$1" > /dev/null
  echo "  → sent: $1"
}

echo ""

case "$1" in

# ─────────────────────────────────────────────────────────────────
# SCENARIO 1: Classic drift (Reddit rabbit hole)
# Expect: LLM flags drift, confidence ~0.8-0.9, checkpoint fires
# ─────────────────────────────────────────────────────────────────
drift)
  echo "SCENARIO: Classic drift — Reddit during deep work"
  sleep 1
  post_event '{"source":"simulator","type":"tab_change","payload":{"domain":"github.com","duration_sec":45}}'
  sleep 2
  post_event '{"source":"simulator","type":"tab_change","payload":{"domain":"reddit.com","duration_sec":200}}'
  sleep 1
  post_event '{"source":"glasses","type":"accel_snapshot","payload":{"summary":"Head still, slight downward tilt — consistent with passive scroll"}}'
  sleep 1
  post_event '{"source":"simulator","type":"idle","payload":{"duration_sec":90}}'
  echo "Done. Wait ~30s for agent loop to fire."
  ;;

# ─────────────────────────────────────────────────────────────────
# SCENARIO 2: Intentional research (should NOT flag drift)
# Expect: LLM says on track, low confidence, no checkpoint
# ─────────────────────────────────────────────────────────────────
research)
  echo "SCENARIO: Intentional research — Stack Overflow + docs during coding"
  sleep 1
  post_event '{"source":"simulator","type":"tab_change","payload":{"domain":"github.com","duration_sec":120}}'
  sleep 2
  post_event '{"source":"simulator","type":"tab_change","payload":{"domain":"stackoverflow.com","duration_sec":90}}'
  sleep 1
  post_event '{"source":"simulator","type":"tab_change","payload":{"domain":"docs.anthropic.com","duration_sec":60}}'
  sleep 1
  post_event '{"source":"glasses","type":"accel_snapshot","payload":{"summary":"Occasional head movement, reading posture — active engagement"}}'
  echo "Done. Agent should say ON TRACK."
  ;;

# ─────────────────────────────────────────────────────────────────
# SCENARIO 3: Ambiguous case — email + Slack during a meeting
# Expect: LLM reasons carefully, moderate confidence
# ─────────────────────────────────────────────────────────────────
ambiguous)
  echo "SCENARIO: Ambiguous — Gmail + Slack during focus session"
  sleep 1
  post_event '{"source":"simulator","type":"tab_change","payload":{"domain":"notion.so","duration_sec":80}}'
  sleep 2
  post_event '{"source":"simulator","type":"tab_change","payload":{"domain":"mail.google.com","duration_sec":45}}'
  sleep 1
  post_event '{"source":"simulator","type":"app_switch","payload":{"from":"Notion","to":"Slack"}}'
  sleep 1
  post_event '{"source":"glasses","type":"accel_snapshot","payload":{"summary":"Head moving, typing bursts — appears actively working"}}'
  sleep 1
  post_event '{"source":"simulator","type":"tab_change","payload":{"domain":"mail.google.com","duration_sec":120}}'
  echo "Done. Watch how the LLM reasons about email in context."
  ;;

# ─────────────────────────────────────────────────────────────────
# SCENARIO 4: Accelerometer-only drift signal
# Phone pickup: head tilts down + keyboard goes idle
# ─────────────────────────────────────────────────────────────────
phone)
  echo "SCENARIO: Phone pickup — accel + idle signal only"
  sleep 1
  post_event '{"source":"simulator","type":"tab_change","payload":{"domain":"localhost:3000","duration_sec":300}}'
  sleep 2
  post_event '{"source":"simulator","type":"idle","payload":{"duration_sec":120}}'
  sleep 1
  post_event '{"source":"glasses","type":"accel_snapshot","payload":{"summary":"Sustained downward head tilt for 2min, no keyboard/mouse — likely on phone"}}'
  echo "Done. Tests whether accel alone can trigger drift detection."
  ;;

# ─────────────────────────────────────────────────────────────────
# SCENARIO 5: Memory demo — teach it reddit = drift, then show it firing faster
# Run this AFTER responding 'switch' to a reddit checkpoint once already
# ─────────────────────────────────────────────────────────────────
memory)
  echo "SCENARIO: Memory — reddit with prior drift history (should fire with urgency)"
  sleep 1
  post_event '{"source":"simulator","type":"tab_change","payload":{"domain":"reddit.com","duration_sec":60}}'
  sleep 1
  post_event '{"source":"glasses","type":"accel_snapshot","payload":{"summary":"Head still, downward tilt"}}'
  echo "Done. Check if reasoning mentions memory context and fires faster."
  ;;

# ─────────────────────────────────────────────────────────────────
# SCENARIO 6: Mode comparison demo — same signals, Locked In vs Light
# Run once per mode to show the difference in reasoning
# ─────────────────────────────────────────────────────────────────
mode_demo)
  echo "SCENARIO: Mode demo — moderate distraction signals"
  sleep 1
  post_event '{"source":"simulator","type":"tab_change","payload":{"domain":"twitter.com","duration_sec":90}}'
  sleep 1
  post_event '{"source":"glasses","type":"accel_snapshot","payload":{"summary":"Mostly still, casual head movement"}}'
  echo "Done. Switch between Light/Deep/Locked In in the dashboard and repeat to compare."
  ;;

*)
  echo "Usage: bash scripts/test_scenarios.sh <scenario>"
  echo ""
  echo "Available scenarios:"
  echo "  drift      — Reddit rabbit hole, clear drift (expect checkpoint)"
  echo "  research   — Stack Overflow + docs, intentional (expect ON TRACK)"
  echo "  ambiguous  — Gmail + Slack, let LLM reason it out"
  echo "  phone      — Phone pickup via accelerometer signal only"
  echo "  memory     — Tests memory layer (run after drift scenario + 'switch' response)"
  echo "  mode_demo  — Same signals across Light/Deep/Locked In modes"
  ;;
esac

echo ""
