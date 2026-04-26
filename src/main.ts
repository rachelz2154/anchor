import {
  CreateStartUpPageContainer,
  TextContainerProperty,
  TextContainerUpgrade,
  waitForEvenAppBridge,
} from '@evenrealities/even_hub_sdk'
import './style.css'

const APP_CONTAINER_ID = 1
const BACKEND_URL = 'https://anchor-oscillating-backend-1025873815315.us-central1.run.app'
const POLL_INTERVAL_MS = 5_000
const TEXT_CONTAINER_NAME = 'backend-result'

const app = document.querySelector<HTMLDivElement>('#app')

if (!app) {
  throw new Error('Missing #app root element.')
}

app.innerHTML = `
  <main class="shell">
    <p class="eyebrow">Even G2 — Anchor</p>
    <h1>Backend Poll</h1>
    <p class="body">
      Polls the deployed backend every 5 seconds and renders the backend response.
    </p>
    <p class="status" id="backend-text" aria-live="polite"></p>
  </main>
`

const backendTextNode = document.querySelector<HTMLParagraphElement>('#backend-text')

if (!backendTextNode) {
  throw new Error('Missing #backend-text element.')
}

type BackendPayload = {
  text: string
}

const isBackendPayload = (value: unknown): value is BackendPayload => {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  return typeof (value as { text?: unknown }).text === 'string'
}

const fetchBackendText = async () => {
  const response = await fetch(BACKEND_URL, { cache: 'no-store' })

  if (!response.ok) {
    throw new Error(`Backend request failed with ${response.status}`)
  }

  const payload: unknown = await response.json()

  if (!isBackendPayload(payload)) {
    throw new Error('Backend response did not include text.')
  }

  return payload.text
}

const createTextContainer = (content: string) =>
  new TextContainerProperty({
    xPosition: 0,
    yPosition: 0,
    width: 576,
    height: 288,
    borderWidth: 0,
    borderColor: 5,
    paddingLength: 12,
    containerID: APP_CONTAINER_ID,
    containerName: TEXT_CONTAINER_NAME,
    content,
    isEventCapture: 1,
  })

let bridge: Awaited<ReturnType<typeof waitForEvenAppBridge>> | null = null
let hasCreatedStartupPage = false
let pollInFlight = false

const renderOnGlasses = async (content: string) => {
  if (!bridge) {
    return
  }

  if (!hasCreatedStartupPage) {
    const result = await bridge.createStartUpPageContainer(
      new CreateStartUpPageContainer({
        containerTotalNum: 1,
        textObject: [createTextContainer(content)],
      }),
    )

    if (result !== 0) {
      throw new Error(`Page creation failed with code ${result}`)
    }

    hasCreatedStartupPage = true
    return
  }

  const success = await bridge.textContainerUpgrade(
    new TextContainerUpgrade({
      containerID: APP_CONTAINER_ID,
      containerName: TEXT_CONTAINER_NAME,
      content,
    }),
  )

  if (!success) {
    throw new Error('Text container update failed.')
  }
}

const pollBackend = async () => {
  if (pollInFlight) {
    return
  }

  pollInFlight = true

  try {
    const backendText = await fetchBackendText()
    backendTextNode.textContent = backendText
    await renderOnGlasses(backendText)
  } catch (error) {
    console.warn('Backend poll failed', error)
  } finally {
    pollInFlight = false
  }
}

const connectBridge = async () => {
  try {
    bridge = await waitForEvenAppBridge()
  } catch (error) {
    console.warn('Even bridge connection failed', error)
  }
}

void connectBridge()
void pollBackend()
window.setInterval(() => {
  void pollBackend()
}, POLL_INTERVAL_MS)
