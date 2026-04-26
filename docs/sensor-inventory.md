# Anchor — Sensor / Input Inventory (Even G2)

> **TL;DR.** The G2 gives us 5 truly useful real-time signals: **IMU (3-axis accel)**, **mic array (16 kHz PCM)**, **wearing state**, **touchpad/ring gestures**, and **battery/charging/case state**. There is **no camera, no eye tracking, no gyro/magnetometer, no GPS, no heart rate, no haptics, no speaker.** Anything beyond the list below has to come from the paired phone.

Scraped 2026-04-26 against `@evenrealities/even_hub_sdk@0.0.10`.

---

## Full input inventory

| # | Input | SDK call | Stream / Poll | Payload | Anchor use |
|---|---|---|---|---|---|
| 1 | **4-mic array → PCM** | `bridge.audioControl(true)` → `audioEvent.audioPcm` | Streaming, 100 ms chunks @ 16 kHz (~10 events/s, 3200 B each) | `Uint8Array` | VAD ("in conversation?"), ambient noise level, whisper detection, optional wake-word, on-device speech via phone |
| 2 | **IMU (3-axis accel)** | `bridge.imuControl(true, ImuReportPace.PXXX)` → `sysEvent.imuData` | Streaming, configurable 100–1000 ms period | `{x, y, z}` floats | Head-still vs head-roaming (focus proxy), nod/shake gestures, posture slump, fidget, "got up and left" |
| 3 | **Wearing state** | `bridge.getDeviceInfo()` + `onDeviceStatusChanged()` | Pull + push | `isWearing: boolean` | Hard gate — pause Anchor when off head |
| 4 | **Battery %** | `bridge.getDeviceInfo()` + `onDeviceStatusChanged()` | Pull + push | `batteryLevel: number` | Session budget, low-battery nudge |
| 5 | **Charging** | same | Push | `isCharging: boolean` | "At the desk" hint |
| 6 | **In case** | same | Push | `isInCase: boolean` | Definitive "session over" signal |
| 7 | **Connection state** | `bridge.onDeviceStatusChanged()` | Push | `DeviceConnectType` (`none/connecting/connected/disconnected/connectionFailed`) | Reconnection UX |
| 8 | **Touchpad gestures** | `bridge.onEvenHubEvent()` → `listEvent`/`textEvent` on the event-capture container | Push | Up swipe / Down swipe / Click / Double-Click | "Start focus", "Snooze 5 min", "End", dismiss nudges |
| 9 | **R1 ring input** | same firehose, `eventSource = ring` | Push | Same gesture vocab as touchpad | Same actions, hands-off |
| 10 | **Event source attribution** | `Sys_ItemEvent.eventSource` (4 values: left temple / right temple / ring / system) | Push attribute on every input event | enum | Bind different actions per surface (e.g. left = pause, right = end) |
| 11 | **List item selection** | `bridge.onEvenHubEvent()` → `listEvent` | Push | `currentSelectItemIndex`, `currentSelectItemName` | Menu-style command surface (focus presets, durations) |
| 12 | **Launch source** | `bridge.onLaunchSource(cb)` | Push (once at start) | `'appMenu' \| 'glassesMenu'` | Different cold-start UX: phone vs glasses |
| 13 | **System exit** | `sysEvent.systemExitReasonCode` | Push | int | Save session state on exit |
| 14 | **Device model** | `bridge.getDeviceInfo().model` | Pull | `G1 \| G2 \| Ring1` | Capability gating |
| 15 | **User identity** | `bridge.getUserInfo()` | Pull | `{ uid, name, avatar, country }` | Personalization, multi-user safety |
| 16 | **Local storage** | `bridge.setLocalStorage / getLocalStorage` | Pull | KV string | Persist sessions, streaks, prefs |

---

## NOT available on G2 (do not design around these)

Camera, RGB images, eye tracking, gaze, GPS, heart rate / PPG, skin temp, EDA, gyro, magnetometer, head orientation (yaw/pitch/roll), speaker output, raw Bluetooth, arbitrary pixel drawing, animations, color, audio output, haptics. Anything in this list must come from the **paired phone**, not the glasses.

---

## Recommended Anchor signal stack (priority order)

1. **IMU @ `ImuReportPace.P200` or `P500`** — primary "is the user's head settled?" signal. Compute rolling motion-energy from `(x,y,z)`; sustained low energy = in-flow, sudden spikes = potential distraction. Cheapest sensor with the highest signal density.
2. **Wearing state** — hard gate. No glasses → no session. Subscribe via `onDeviceStatusChanged`.
3. **Microphone-derived VAD + RMS noise level** — detects conversation interruptions and noisy environments. **Compute features on the phone, discard raw PCM** (privacy).
4. **Touchpad / R1 events** — explicit "Start focus", "Snooze 5 min", "End session", nudge dismissal. Use `eventSource` to differentiate left-temple ≠ right-temple ≠ ring.
5. **Battery / charging / in-case** — session lifecycle signals (charging → at desk; in-case → done; low-battery → wrap up).
6. **Local storage** — durable session log, streaks, prefs.
7. **Launch source** — branch UX: opened from `appMenu` (phone) vs `glassesMenu` (heads-up quick action).

### Phone-side complements (out of glasses scope, flag to team)

Foreground app / notification stream, screen-on time, location/Wi-Fi for "at desk vs out", calendar — these are the natural pair for the glasses signals and likely live in the Even App or a companion phone module.

---

## Open items to validate at the hackathon

- **IMU units & rate** — docs conflict on whether `ImuReportPace.P100` means "100 ms period" (10 Hz, per simulator README) or just an opaque protocol code (per device-apis page). Log timestamps from `IMU_DATA_REPORT` and measure.
- **`EventSourceType`** has 4 values; only "glasses left/right, ring" are documented. Capture the exact strings at runtime.
- **`OsEventTypeList`** has 9 values; only `IMU_DATA_REPORT` and `SYSTEM_EXIT_EVENT` are explicitly named. The other 7 are likely touchpad gestures (Up/Down/Click/Double-Click) — log to map.
- **Simulator does not emit IMU or status events** — IMU + wearing logic must be tested on real hardware.
- **`IMU_Report_Data` units** — `{ x, y, z }` are floats but docs don't say m/s² vs g vs raw counts. Sample a known still pose and a known motion to calibrate.
