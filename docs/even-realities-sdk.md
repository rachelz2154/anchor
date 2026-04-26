# Even Realities G2 — SDK Reference (offline copy)

Internal reference for Team Anchor. Scraped from upstream docs + the published npm package on **2026-04-26**, against `@evenrealities/even_hub_sdk@0.0.10`.

Upstream:
- https://hub.evenrealities.com/docs/guides/device-apis
- https://hub.evenrealities.com/docs/guides/display
- https://hub.evenrealities.com/docs/guides/design-guidelines
- https://hub.evenrealities.com/docs/getting-started/overview/
- https://www.npmjs.com/package/@evenrealities/even_hub_sdk
- https://www.npmjs.com/package/@evenrealities/evenhub-simulator
- https://www.npmjs.com/package/@evenrealities/evenhub-cli

---

## 1. Hardware baseline

- **Form factor:** Even Realities G2 smart glasses. Optional Even R1 ring for additional input.
- **Display:** dual micro-LED, **576 × 288 px per eye**, **4-bit greyscale (16 shades of green)**. Bright green ≈ white; transparent ≈ black. Origin (0,0) at top-left, X right, Y down.
- **No camera, no speaker** — privacy by design. All TTS / audio output is on the phone.
- **Connection:** Bluetooth 5.2 to a paired phone. Plugin runs in a WebView inside the Even App on the phone; glasses do display rendering and sensor streaming only.
- **Microphone array:** 4 mics, output to plugin as a single mono stream — **16 kHz, signed 16-bit little-endian PCM**. Simulator framing: 3200 bytes / 100 ms chunk, ~10 events/s.
- **IMU:** 3-axis acceleration `(x, y, z)` floats. **Gyro / magnetometer not exposed.** Pacing options every 100 ms (`P100`) up to every 1000 ms (`P1000`).
- **Touchpads:** left + right temple. Gesture vocabulary surfaced through SDK: **Up, Down, Click, Double Click** (confirmed via simulator).
- **Status sensors:** wearing detection, charging detection, in-case detection, battery %.
- **Supported device models** (`DeviceModel` enum): **G1, G2, Ring1**.

---

## 2. SDK runtime model

The SDK is a typed **WebView bridge**. The Even App on the phone hosts a WebView, the plugin (Vite/React/vanilla JS) loads inside it, and the SDK opens a JSON message channel to the native app. The bridge is exposed as a singleton `EvenAppBridge`.

### Install

```bash
npm install @evenrealities/even_hub_sdk
# or yarn / pnpm
```

Requires Node `^20.0.0 || >=22.0.0`. Author: Whiskee (whiskee.chen@evenrealities.com). MIT.

### Initialization

```ts
import { waitForEvenAppBridge, EvenAppBridge } from '@evenrealities/even_hub_sdk';

const bridge = await waitForEvenAppBridge();
// or, if you're sure init has completed:
const bridge = EvenAppBridge.getInstance();
```

### Push channel

The native app pushes events into the WebView via `window._listenEvenAppMessage(message)`. The SDK normalizes them and dispatches via `bridge.onEvenHubEvent()` and friends. Compatible payload shapes:

```json
{ "type": "listen_even_app_data", "method": "evenHubEvent",
  "data": { "type": "listEvent", "jsonData": { "containerID": 1, "currentSelectItemName": "item1" } } }
```

Also accepts: `data: { type: 'list_event', data: {...} }` and `data: [ 'list_event', {...} ]`.

### dist artifacts

- `dist/index.cjs` (CommonJS) + `dist/index.js` (ESM) + `dist/index.d.ts` (types).
- **dist source is obfuscated** — treat the README and `.d.ts` as the contract.

### Sibling packages

- `@evenrealities/evenhub-simulator` — local glasses simulator with HTTP automation port.
- `@evenrealities/evenhub-cli` — `qr`, `init`, `login`, `pack` (.ehpk) commands.

---

## 3. `EvenAppBridge` API (every method)

### 3.1 Lifecycle / metadata

| Method | Returns | Notes |
|---|---|---|
| `waitForEvenAppBridge()` | `Promise<EvenAppBridge>` | Resolves once the WebView bridge is wired up. Recommended entry point. |
| `EvenAppBridge.getInstance()` | `EvenAppBridge` | Singleton accessor. |
| `bridge.onLaunchSource(cb)` | `unsubscribe` | Fires once with `'appMenu' \| 'glassesMenu'`. Tells you whether the user opened the plugin from the phone app menu or the glasses menu. Register early. |
| `bridge.callEvenApp(method, payload?)` | `Promise<any>` | Generic escape hatch — invoke any `EvenAppMethod` directly. |

### 3.2 User & device info

```ts
const user   = await bridge.getUserInfo();      // UserInfo
const device = await bridge.getDeviceInfo();    // DeviceInfo | null
```

```ts
const unsubscribe = bridge.onDeviceStatusChanged((status: DeviceStatus) => {
  status.connectType;   // DeviceConnectType
  status.batteryLevel;  // number
  status.isWearing;     // boolean
  status.isCharging;    // boolean
  status.isInCase;      // boolean
});
```

### 3.3 Local storage (app-side persistence)

```ts
await bridge.setLocalStorage('focus.streak', '7');
const v = await bridge.getLocalStorage('focus.streak'); // string | null
```

### 3.4 Display / containers

> Container ops are required before audio or IMU control. Call `createStartUpPageContainer` exactly once first.

```ts
await bridge.createStartUpPageContainer({
  containerTotalNum: 2,        // 1..12
  listObject:  [/* ListContainerProperty[] */],
  textObject:  [/* TextContainerProperty[] */],
  imageObject: [/* ImageContainerProperty[] */],
});

await bridge.rebuildPageContainer({ /* same shape, used to swap pages */ });
await bridge.textContainerUpgrade({ containerID, containerName, content }); // ≤ 2000 chars
await bridge.updateImageRawData({  containerID, containerName, imageData }); // greyscale bytes
await bridge.shutDownPageContainer(0); // 0 = immediate, 1 = show interaction
```

Constraints:
- 1–12 containers per page; ≤ 8 text + ≤ 4 image.
- Text content ≤ 1000 chars at startup, ≤ 2000 on upgrade.
- List ≤ 20 items × 64 chars each.
- Image: width 20–288 px, height 20–144 px; payload as `number[] | string | Uint8Array | ArrayBuffer`.
- **Exactly one container per page must have `isEventCapture: 1`.** That container receives all touchpad / ring input events.

### 3.5 Audio control

```ts
await bridge.audioControl(true);   // start mic stream
await bridge.audioControl(false);  // stop
```

- Stream is **non-concurrent**: each chunk must be acknowledged before the next is sent.
- Each `audioEvent` carries `audioPcm: Uint8Array`.
- Simulator framing: **3200 bytes per event, 100 ms of 16 kHz / 16-bit / mono PCM** ⇒ ~32 KB/s.

### 3.6 IMU control

```ts
import { ImuReportPace, OsEventTypeList } from '@evenrealities/even_hub_sdk';

await bridge.imuControl(true, ImuReportPace.P500);
// later
await bridge.imuControl(false, ImuReportPace.P100);
```

- `ImuReportPace`: `P100, P200, P300, P400, P500, P600, P700, P800, P900, P1000` (step 100). Simulator README treats these as **report period in milliseconds** (`P100` ⇒ 10 Hz). The device-apis page warns they are "protocol pacing codes, not literal Hz values" — confirm on hardware.
- Samples arrive as `sysEvent.imuData = { x, y, z }` floats. Units undocumented — calibrate against a known still pose.

### 3.7 The event firehose

```ts
const unsubscribe = bridge.onEvenHubEvent((event: EvenHubEvent) => {
  if (event.listEvent)  { /* user picked a list item */ }
  if (event.textEvent)  { /* text container interaction */ }
  if (event.sysEvent)   { /* system event incl. IMU sample */ }
  if (event.audioEvent) { /* event.audioEvent.audioPcm: Uint8Array */ }
  if (event.jsonData)   { /* raw JSON, escape hatch */ }
});
```

---

## 4. Data classes

### `UserInfo`
```ts
interface UserInfo {
  uid: number; name: string; avatar: string; country: string;
  toJson(): Record<string, any>;
  static fromJson(json: any): UserInfo;
  static createDefault(): UserInfo;
}
```

### `DeviceInfo`
```ts
interface DeviceInfo {
  readonly model: DeviceModel; // G1 | G2 | Ring1
  readonly sn: string;
  status: DeviceStatus;
  updateStatus(status: DeviceStatus): void;
  isGlasses(): boolean;
  isRing(): boolean;
  toJson(): Record<string, any>;
  static fromJson(json: any): DeviceInfo;
}
```

### `DeviceStatus`
```ts
interface DeviceStatus {
  readonly sn: string;
  connectType: DeviceConnectType;
  isWearing?: boolean;
  batteryLevel?: number;
  isCharging?: boolean;
  isInCase?: boolean;
  toJson(): Record<string, any>;
  isNone(): boolean;
  isConnected(): boolean;
  isConnecting(): boolean;
  isDisconnected(): boolean;
  isConnectionFailed(): boolean;
  static fromJson(json: any): DeviceStatus;
  static createDefault(sn?: string): DeviceStatus;
}
```

### `EvenHubEvent`
```ts
interface EvenHubEvent {
  listEvent?:  List_ItemEvent;
  textEvent?:  Text_ItemEvent;
  sysEvent?:   Sys_ItemEvent;
  audioEvent?: { audioPcm: Uint8Array };
  jsonData?:   Record<string, any>;
}
```

### Sub-event shapes
```ts
interface List_ItemEvent {
  containerID?: number; containerName?: string;
  currentSelectItemName?: string; currentSelectItemIndex?: number;
  eventType?: OsEventTypeList;
}

interface Text_ItemEvent {
  containerID?: number; containerName?: string;
  eventType?: OsEventTypeList;
}

interface Sys_ItemEvent {
  eventType?: OsEventTypeList;
  eventSource?: EventSourceType;
  imuData?: IMU_Report_Data;
  systemExitReasonCode?: number;
}

interface IMU_Report_Data { x?: number; y?: number; z?: number; }
```

### Container property shapes (display)
```ts
interface ListContainerProperty {
  xPosition?: number; yPosition?: number;   // 0..576 / 0..288
  width?: number;     height?: number;      // 0..576 / 0..288
  borderWidth?: number;     // 0..5
  borderColor?: number;     // 0..15
  borderRadius?: number;    // 0..10
  paddingLength?: number;   // 0..32
  containerID?: number; containerName?: string; // ≤ 16 chars
  itemContainer?: ListItemContainerProperty;
  isEventCapture?: 0 | 1;
}

interface ListItemContainerProperty {
  itemCount?: number;          // 1..20
  itemWidth?: number;          // 0 = auto, other = fixed
  isItemSelectBorderEn?: 0 | 1;
  itemName?: string[];         // ≤ 20 entries × ≤ 64 chars
}

interface TextContainerProperty {
  xPosition?: number; yPosition?: number; width?: number; height?: number;
  borderWidth?: number; borderColor?: number; borderRadius?: number; paddingLength?: number;
  containerID?: number; containerName?: string;
  isEventCapture?: 0 | 1;
  content?: string;            // ≤ 1000 chars at startup
}

interface TextContainerUpgrade {
  containerID?: number; containerName?: string;
  contentOffset?: number; contentLength?: number;
  content?: string;            // ≤ 2000 chars on upgrade
}

interface ImageContainerProperty {
  xPosition?: number; yPosition?: number;
  width?: number;   // 20..288
  height?: number;  // 20..144
  containerID?: number; containerName?: string;
}

interface ImageRawDataUpdate {
  containerID?: number; containerName?: string;
  imageData?: number[] | string | Uint8Array | ArrayBuffer;
}

interface CreateStartUpPageContainer {
  containerTotalNum?: number;  // 1..12
  widgetId?: number;
  listObject?: ListContainerProperty[];
  textObject?: TextContainerProperty[];
  imageObject?: ImageContainerProperty[];
}

interface RebuildPageContainer {
  containerTotalNum?: number;
  listObject?: ListContainerProperty[];
  textObject?: TextContainerProperty[];
  imageObject?: ImageContainerProperty[];
}
```

---

## 5. Enums

```ts
enum EvenAppMethod {
  GetUserInfo = 'getUserInfo',
  GetGlassesInfo = 'getGlassesInfo',
  SetLocalStorage = 'setLocalStorage',
  GetLocalStorage = 'getLocalStorage',
  CreateStartUpPageContainer = 'createStartUpPageContainer',
  RebuildPageContainer = 'rebuildPageContainer',
  UpdateImageRawData = 'updateImageRawData',
  TextContainerUpgrade = 'textContainerUpgrade',
  AudioControl = 'audioControl',
  ImuControl = 'imuControl',
  ShutDownPageContainer = 'shutDownPageContainer',
}

enum DeviceConnectType {
  None = 'none',
  Connecting = 'connecting',
  Connected = 'connected',
  Disconnected = 'disconnected',
  ConnectionFailed = 'connectionFailed',
}

enum DeviceModel { G1, G2, Ring1 }      // 3 values
enum ImuReportPace { P100, P200, P300, P400, P500, P600, P700, P800, P900, P1000 }
enum OsEventTypeList { /* 9 values; SYSTEM_EXIT_EVENT, IMU_DATA_REPORT named; others discoverable at runtime */ }
enum EventSourceType { /* 4 values: glasses-left, glasses-right, ring, system (exact strings to be confirmed at runtime) */ }
enum EvenHubEventType { /* 5 values: listEvent, textEvent, sysEvent, audioEvent, + 1 */ }
enum BridgeEvent { /* 4 lifecycle values */ }
enum EvenHubErrorCodeName { /* 15 values */ }
enum StartUpPageCreateResult { Success = 0, Invalid = 1, Oversize = 2, OutOfMemory = 3 }
enum ImageRawDataUpdateResult { /* 5 values */ }
```

Utility helpers exported alongside types: `pick`, `pickLoose`, `readNumber`, `readString`, `toNumber`, `toString`, `isObjectRecord`, `normalizeLooseKey`, `toObjectRecord`, `bytesToJson`, `createDefaultEvenHubEvent`, `evenHubEventFromJson`.

---

## 6. UI / UX rules (for context)

- Plain, left-aligned text; auto-wrap; supports `\n` and Unicode.
- No CSS, flexbox, or DOM. Borders only on text/list (0–5 px width, optional rounded corners).
- No background fill — structure comes from borders + spacing.
- Selection cue: prefix items with `>` or toggle border width.
- Pre-paginate long content at 400–500 char boundaries.
- One LVGL font with predefined glyph sets (progress, navigation, selection).
- Greyscale icons render as green tones on hardware — design at native resolution.

---

## 7. Toolchain

### Simulator (`@evenrealities/evenhub-simulator`)

```bash
npm install -g @evenrealities/evenhub-simulator
evenhub-simulator --automation-port 9999
```

Flags: `-c <config>`, `-g/--no-glow`, `-b <bounce>` (default | spring), `--list-audio-input-devices`, `--aid <device>`, `--print-config-path`, `--completions <shell>`, `-V`.

**Automation HTTP API** (when `--automation-port` is set):

| Endpoint | Returns |
|---|---|
| `/api/ping` | health |
| `/api/screenshot/glasses` | 576×288 RGBA PNG framebuffer |
| `/api/screenshot/webview` | WebView screenshot |
| `/api/console` | captured console output (supports `?since_id=N`) |
| `/api/input` | accepts touchpad actions (Up / Down / Click / Double Click) |

Simulator limitations to remember:
- IMU stream returns null — **test IMU on real hardware only**.
- Status events are hardcoded (no live battery / wearing changes).
- No ring / haptic simulation.
- Audio is generated; mic-array spatial features are not faithful.

### CLI (`@evenrealities/evenhub-cli`)

| Command | Purpose |
|---|---|
| `qr`    | Generates QR code linking the Even App to your local dev server (the only command needed in dev mode). |
| `init`  | Scaffolds a new project with `app.json`. |
| `login` | Authenticates with Even Realities account; caches credentials. |
| `pack`  | Packages a built project into `.ehpk` for Hub submission. |

### Workflow

`code → simulator → device test → pack (.ehpk) → Hub submission`.

---

## 8. Worked examples

### 8.1 Minimal startup with audio + IMU

```ts
import {
  waitForEvenAppBridge,
  ImuReportPace,
  OsEventTypeList,
  TextContainerProperty,
} from '@evenrealities/even_hub_sdk';

const bridge = await waitForEvenAppBridge();

const text: TextContainerProperty = {
  xPosition: 0, yPosition: 0, width: 576, height: 288,
  containerID: 1, containerName: 'root',
  isEventCapture: 1,
  content: 'Anchor — focus mode',
};

await bridge.createStartUpPageContainer({ containerTotalNum: 1, textObject: [text] });

await bridge.audioControl(true);
await bridge.imuControl(true, ImuReportPace.P500);

bridge.onEvenHubEvent((event) => {
  if (event.audioEvent) {
    // 100 ms PCM chunk — extract VAD / RMS on phone, discard raw
  }
  if (event.sysEvent?.eventType === OsEventTypeList.IMU_DATA_REPORT && event.sysEvent.imuData) {
    const { x = 0, y = 0, z = 0 } = event.sysEvent.imuData;
    // accumulate motion energy
  }
  if (event.listEvent || event.textEvent) {
    // touchpad / ring input — eventSource on sysEvent tells you which surface
  }
});

bridge.onDeviceStatusChanged((s) => {
  if (s.isWearing === false) {
    // pause focus session
  }
});
```

### 8.2 Listening for the launch source

```ts
bridge.onLaunchSource((source) => {
  if (source === 'glassesMenu') {
    // user opened from the glasses HUD — show compact entry point
  } else {
    // 'appMenu' — full settings UI on phone
  }
});
```

---

## 9. Things explicitly NOT exposed

Camera, RGB images, eye tracking, gaze, GPS, heart rate / PPG, skin temp, EDA, gyro, magnetometer, head orientation (yaw/pitch/roll), speaker output, raw Bluetooth, arbitrary pixel drawing, animations, color, audio output, haptics, scroll positioning, item-level styling, background colors. Anything in this list comes from the **paired phone**, not the glasses.

---

## 10. Known ambiguities

- **`ImuReportPace` units** — simulator README says "100–1000 ms" period; device-apis page says "protocol pacing codes, not literal Hz". Measure on hardware.
- **`OsEventTypeList`** has 9 values; only `IMU_DATA_REPORT` and `SYSTEM_EXIT_EVENT` are explicitly named. Log unknown values to map gestures.
- **`EventSourceType`** has 4 values; docs only describe "glasses left/right, ring, etc." Capture exact strings at runtime.
- **`IMU_Report_Data` units** undocumented — could be m/s², g, or raw counts.
- **dist source obfuscated** — types are the only contract; behavior changes between versions can be invisible.
- **Simulator does not faithfully emit** IMU, status changes, ring input, or haptics — verify on real hardware.
