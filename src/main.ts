import {
  CreateStartUpPageContainer,
  ImuReportPace,
  OsEventTypeList,
  TextContainerProperty,
  TextContainerUpgrade,
  waitForEvenAppBridge,
} from '@evenrealities/even_hub_sdk'
import './style.css'

const app = document.querySelector<HTMLDivElement>('#app')
const ANCHOR_API_ORIGIN =
  (import.meta as ImportMeta & { env?: { VITE_ANCHOR_API_ORIGIN?: string } }).env
    ?.VITE_ANCHOR_API_ORIGIN || 'http://localhost:8000'

type FocusMessage = {
  userOnTrack?: boolean
  message?: string
  status?: string
  createdAt?: string
}

type ImuState = {
  mode: 'Focus' | 'Distracted'
  energy: number
  movingFrac: number
  x: number
  y: number
  z: number
}

if (!app) {
  throw new Error('Missing #app root element.')
}

app.innerHTML = `
  <main class="shell">
    <p class="eyebrow">Even G2 — Anchor</p>
    <h1>IMU Probe</h1>
    <p class="body">
      Shows the latest Anchor focus check from your browser activity and keeps
      IMU status visible for debugging.
    </p>
    <section class="focus-card" id="focus-card">
      <p class="focus-label">Latest focus check</p>
      <p class="focus-message" id="focus-message">Waiting for Anchor...</p>
      <p class="focus-meta" id="focus-meta">No message yet.</p>
    </section>
    <p class="status" id="status">Waiting for the Even bridge...</p>
  </main>
`

const statusNode = document.querySelector<HTMLParagraphElement>('#status')
const focusCard = document.querySelector<HTMLElement>('#focus-card')
const focusMessageNode = document.querySelector<HTMLParagraphElement>('#focus-message')
const focusMetaNode = document.querySelector<HTMLParagraphElement>('#focus-meta')

if (!statusNode || !focusCard || !focusMessageNode || !focusMetaNode) {
  throw new Error('Missing required Anchor UI elements.')
}

const setStatus = (message: string) => {
  statusNode.textContent = message
}

const formatGlassContent = (message: FocusMessage | null, imu: ImuState | null) => {
  const prefix = message?.userOnTrack ? 'On track' : 'Check focus'
  const focusLine = message?.message ? message.message.slice(0, 52) : 'Waiting for focus check...'
  const imuLine = imu
    ? `${imu.mode} e:${imu.energy.toFixed(2)} f:${imu.movingFrac.toFixed(2)}`
    : 'IMU waiting for samples...'
  const axisLine = imu
    ? `x:${imu.x.toFixed(1)} y:${imu.y.toFixed(1)} z:${imu.z.toFixed(1)}`
    : ''
  return `Anchor — ${prefix}\n${focusLine}\n${imuLine}\n${axisLine}`.trim()
}

const renderFocusMessage = (message: FocusMessage | null) => {
  focusCard.classList.toggle('off-track', message?.userOnTrack === false)
  focusCard.classList.toggle('on-track', message?.userOnTrack === true)
  focusMessageNode.textContent = message?.message || 'Waiting for Anchor...'
  focusMetaNode.textContent = message?.createdAt
    ? `${message.status || 'ok'} · ${new Date(message.createdAt).toLocaleTimeString()}`
    : 'No message yet.'
}

const fetchLatestFocusMessage = async () => {
  const response = await fetch(`${ANCHOR_API_ORIGIN}/messages/latest`)
  if (!response.ok) {
    throw new Error(`Anchor message fetch failed: ${response.status}`)
  }
  const message = (await response.json()) as FocusMessage
  return message.message ? message : null
}

async function bootstrap() {
  try {
    const bridge = await waitForEvenAppBridge()

    setStatus('Bridge connected. Rendering to the glasses...')
    let latestFocusMessage: FocusMessage | null = null
    let latestImuState: ImuState | null = null

    const helloWorld = new TextContainerProperty({
      xPosition: 0,
      yPosition: 0,
      width: 576,
      height: 288,
      borderWidth: 0,
      borderColor: 5,
      paddingLength: 12,
      containerID: 1,
      containerName: 'hello',
      content: formatGlassContent(null, null),
      isEventCapture: 1,
    })

    const result = await bridge.createStartUpPageContainer(
      new CreateStartUpPageContainer({
        containerTotalNum: 1,
        textObject: [helloWorld],
      }),
    )

    if (result !== 0) {
      setStatus(`The bridge connected, but page creation failed with code ${result}.`)
      return
    }

    // textContainerUpgrade is async and we don't want to flood BLE with writes.
    // IMU at P100 = 10 Hz; cap the on-glass refresh at 5 Hz.
    const minGlassWriteIntervalMs = 200
    let lastGlassWriteAt = 0
    let glassWriteInFlight = false

    const writeGlasses = async (content: string) => {
      if (glassWriteInFlight) {
        return
      }
      glassWriteInFlight = true
      try {
        await bridge.textContainerUpgrade(
          new TextContainerUpgrade({
            containerID: 1,
            containerName: 'hello',
            content,
          }),
        )
      } catch (err) {
        console.warn('textContainerUpgrade failed', err)
      } finally {
        glassWriteInFlight = false
      }
    }

    const refreshFocusMessage = async () => {
      try {
        latestFocusMessage = await fetchLatestFocusMessage()
        renderFocusMessage(latestFocusMessage)
        await writeGlasses(formatGlassContent(latestFocusMessage, latestImuState))
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to fetch Anchor message.'
        latestFocusMessage = { userOnTrack: false, message, status: 'fetch_error' }
        renderFocusMessage(latestFocusMessage)
      }
    }

    await refreshFocusMessage()
    window.setInterval(() => {
      void refreshFocusMessage()
    }, 10_000)

    // Distraction heuristic — first-pass values, calibrate from console.log('imu', ...)
    // STILL_THRESHOLD: per-sample energy above which we count a sample as "moving"
    // MOVING_FRAC_TRIGGER: fraction of the rolling window that must be moving to flip to Distracted
    const STILL_THRESHOLD = 0.5
    const WINDOW_MS = 60_000
    const MOVING_FRAC_TRIGGER = 0.7
    const MIN_SAMPLES = 30
    let prev: { x: number; y: number; z: number } | null = null
    const samples: { t: number; energy: number }[] = []

    bridge.onEvenHubEvent((event) => {
      const sys = event.sysEvent
      if (!sys || sys.eventType !== OsEventTypeList.IMU_DATA_REPORT || !sys.imuData) {
        return
      }

      const x = sys.imuData.x ?? 0
      const y = sys.imuData.y ?? 0
      const z = sys.imuData.z ?? 0

      let energy = 0
      if (prev) {
        const dx = x - prev.x
        const dy = y - prev.y
        const dz = z - prev.z
        energy = Math.sqrt(dx * dx + dy * dy + dz * dz)
      }
      prev = { x, y, z }

      const now = performance.now()
      samples.push({ t: now, energy })
      while (samples.length > 0 && now - samples[0]!.t > WINDOW_MS) {
        samples.shift()
      }

      let mode: 'Focus' | 'Distracted' = 'Focus'
      let movingFrac = 0
      if (samples.length >= MIN_SAMPLES) {
        const movingCount = samples.filter((s) => s.energy > STILL_THRESHOLD).length
        movingFrac = movingCount / samples.length
        if (movingFrac > MOVING_FRAC_TRIGGER) {
          mode = 'Distracted'
        }
      }

      console.log('imu', { x, y, z, energy, mode, movingFrac, n: samples.length })
      latestImuState = { mode, energy, movingFrac, x, y, z }
      setStatus(
        `${mode}  energy:${energy.toFixed(2)}  frac:${movingFrac.toFixed(2)}  ` +
          `x:${x.toFixed(2)} y:${y.toFixed(2)} z:${z.toFixed(2)}`,
      )

      if (glassWriteInFlight || now - lastGlassWriteAt < minGlassWriteIntervalMs) {
        return
      }
      lastGlassWriteAt = now

      void writeGlasses(formatGlassContent(latestFocusMessage, latestImuState))
    })

    await bridge.imuControl(true, ImuReportPace.P100)
    setStatus('IMU streaming. Move your head!')
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    setStatus(`Failed to initialize the Even bridge: ${message}`)
  }
}

void bootstrap()

