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

if (!app) {
  throw new Error('Missing #app root element.')
}

app.innerHTML = `
  <main class="shell">
    <p class="eyebrow">Even G2 — Anchor</p>
    <h1>IMU Probe</h1>
    <p class="body">
      Streams accelerometer x/y/z from the glasses and renders the latest sample
      onto the display.
    </p>
    <p class="status" id="status">Waiting for the Even bridge...</p>
  </main>
`

const statusNode = document.querySelector<HTMLParagraphElement>('#status')

if (!statusNode) {
  throw new Error('Missing #status element.')
}

const setStatus = (message: string) => {
  statusNode.textContent = message
}

async function bootstrap() {
  try {
    const bridge = await waitForEvenAppBridge()

    setStatus('Bridge connected. Rendering to the glasses...')

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
      content: 'Anchor — IMU\nwaiting for samples…',
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

    bridge.onEvenHubEvent((event) => {
      const sys = event.sysEvent
      if (!sys || sys.eventType !== OsEventTypeList.IMU_DATA_REPORT || !sys.imuData) {
        return
      }

      const x = sys.imuData.x ?? 0
      const y = sys.imuData.y ?? 0
      const z = sys.imuData.z ?? 0

      setStatus(`IMU  x: ${x.toFixed(2)}  y: ${y.toFixed(2)}  z: ${z.toFixed(2)}`)

      const now = performance.now()
      if (glassWriteInFlight || now - lastGlassWriteAt < minGlassWriteIntervalMs) {
        return
      }
      lastGlassWriteAt = now
      glassWriteInFlight = true

      const content = `Anchor — IMU\nx: ${x.toFixed(2)}\ny: ${y.toFixed(2)}\nz: ${z.toFixed(2)}`
      bridge
        .textContainerUpgrade(
          new TextContainerUpgrade({
            containerID: 1,
            containerName: 'hello',
            content,
          }),
        )
        .catch((err) => console.warn('textContainerUpgrade failed', err))
        .finally(() => {
          glassWriteInFlight = false
        })
    })

    await bridge.imuControl(true, ImuReportPace.P100)
    setStatus('IMU streaming. Move your head!')
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    setStatus(`Failed to initialize the Even bridge: ${message}`)
  }
}

void bootstrap()

