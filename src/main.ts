import {
  CreateStartUpPageContainer,
  TextContainerProperty,
  waitForEvenAppBridge,
} from '@evenrealities/even_hub_sdk'
import './style.css'

const app = document.querySelector<HTMLDivElement>('#app')

if (!app) {
  throw new Error('Missing #app root element.')
}

app.innerHTML = `
  <main class="shell">
    <p class="eyebrow">Even G2</p>
    <h1>Hello World</h1>
    <p class="body">
      This app waits for the Even Hub bridge and sends a single full-screen text
      container to the glasses.
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
      content: 'Hello World',
      isEventCapture: 1,
    })

    const result = await bridge.createStartUpPageContainer(
      new CreateStartUpPageContainer({
        containerTotalNum: 1,
        textObject: [helloWorld],
      }),
    )

    if (result === 0) {
      setStatus('Hello World sent to the Even G2 display.')
      return
    }

    setStatus(`The bridge connected, but page creation failed with code ${result}.`)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    setStatus(`Failed to initialize the Even bridge: ${message}`)
  }
}

void bootstrap()

