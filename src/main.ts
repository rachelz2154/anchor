import {
  CreateStartUpPageContainer,
  RebuildPageContainer,
  TextContainerProperty,
  waitForEvenAppBridge,
} from '@evenrealities/even_hub_sdk'
import './style.css'

const APP_CONTAINER_ID = 1
const MAX_MESSAGE_LENGTH = 120
const INITIAL_MESSAGE = 'Ready for a custom message.'

const app = document.querySelector<HTMLDivElement>('#app')

if (!app) {
  throw new Error('Missing #app root element.')
}

app.innerHTML = `
  <main class="shell">
    <p class="eyebrow">Even G2</p>
    <h1>Custom Message Tester</h1>
    <p class="body">
      Connect to the Even Hub bridge, then send a custom message to the glasses
      whenever you want.
    </p>
    <label class="field" for="message-input">
      <span>Message</span>
      <textarea
        id="message-input"
        maxlength="${MAX_MESSAGE_LENGTH}"
        rows="4"
        placeholder="Type the message you want to send"
      >${INITIAL_MESSAGE}</textarea>
    </label>
    <div class="actions">
      <button id="send-button" type="button" disabled>Connect to Even Hub…</button>
      <p class="hint" id="character-count">${INITIAL_MESSAGE.length}/${MAX_MESSAGE_LENGTH}</p>
    </div>
    <p class="status" id="status">Waiting for the Even bridge...</p>
  </main>
`

const statusNode = document.querySelector<HTMLParagraphElement>('#status')
const messageInput = document.querySelector<HTMLTextAreaElement>('#message-input')
const sendButton = document.querySelector<HTMLButtonElement>('#send-button')
const characterCount = document.querySelector<HTMLParagraphElement>('#character-count')

if (!statusNode || !messageInput || !sendButton || !characterCount) {
  throw new Error('Missing required UI element.')
}

const setStatus = (message: string) => {
  statusNode.textContent = message
}

const updateCharacterCount = () => {
  characterCount.textContent = `${messageInput.value.length}/${MAX_MESSAGE_LENGTH}`
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
    containerName: 'custom-message',
    content,
    isEventCapture: 1,
  })

let bridge = await waitForEvenAppBridge()
let hasCreatedStartupPage = false
let isSending = false

const setButtonState = () => {
  if (isSending) {
    sendButton.disabled = true
    sendButton.textContent = 'Sending…'
    return
  }

  if (!hasCreatedStartupPage) {
    sendButton.disabled = false
    sendButton.textContent = 'Create message page'
    return
  }

  sendButton.disabled = false
  sendButton.textContent = 'Send message'
}

const ensureStartupPage = async (initialContent: string) => {
  if (hasCreatedStartupPage) {
    return true
  }

  const result = await bridge.createStartUpPageContainer(
    new CreateStartUpPageContainer({
      containerTotalNum: 1,
      textObject: [createTextContainer(initialContent)],
    }),
  )

  if (result !== 0) {
    setStatus(`The bridge connected, but page creation failed with code ${result}.`)
    return false
  }

  hasCreatedStartupPage = true
  return true
}

const sendMessageToGlasses = async () => {
  const trimmedMessage = messageInput.value.trim()

  if (!trimmedMessage) {
    setStatus('Type a message before sending it to the glasses.')
    messageInput.focus()
    return
  }

  isSending = true
  setButtonState()
  setStatus(hasCreatedStartupPage ? 'Updating the glasses display...' : 'Creating the glasses page...')

  try {
    const startupReady = await ensureStartupPage(trimmedMessage)

    if (!startupReady) {
      return
    }

    const success = await bridge.rebuildPageContainer(
      new RebuildPageContainer({
        containerTotalNum: 1,
        textObject: [createTextContainer(trimmedMessage)],
      }),
    )

    if (!success) {
      setStatus('The bridge connected, but the message update did not succeed.')
      return
    }

    setStatus(`Sent to the Even G2 display: “${trimmedMessage}”`)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    setStatus(`Failed to send the message: ${message}`)
  } finally {
    isSending = false
    setButtonState()
  }
}

messageInput.addEventListener('input', updateCharacterCount)
sendButton.addEventListener('click', () => {
  void sendMessageToGlasses()
})
messageInput.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
    event.preventDefault()
    void sendMessageToGlasses()
  }
})

updateCharacterCount()
setStatus('Bridge connected. Ready to send a custom message.')
setButtonState()
