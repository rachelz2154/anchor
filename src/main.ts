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
  userFocused?: boolean
  message?: string
  status?: string
  createdAt?: string
}

type FocusSession = {
  id?: number
  intent?: string
  mode?: string
  active?: number | boolean
}

type SessionSummary = {
  total_minutes: number
  focus_minutes: number
  drift_count: number
  back_on_track_count: number
  focus_score: number
}

type ImuState = {
  mode: 'Focus' | 'Distracted'
  energy: number
  movingFrac: number
  possibleHeadDown: boolean
  headDownSeconds: number
  x: number
  y: number
  z: number
}

type WelcomeChoice = 'yes' | 'no'
type WelcomeState = 'choosing' | 'starting' | 'focused' | 'declined'
type FocusPromptChoice = 'yes' | 'no'
type FocusPromptState = 'idle' | 'asking' | 'answered'
type BreakState = 'idle' | 'active'
type BreakOverState = 'idle' | 'asking'
type SessionEndState = 'idle' | 'showing'

// ── ASCII icons ────────────────────────────────────────────────────────────
const ICON_ROBOT  = ' [^_^] '
const ICON_WALK   = '  ~O>  '
const ICON_COFFEE = ' _( )_ '
const ICON_BELL   = '  /!\\  '
const ICON_CLAP   = '  \\o/  '
const ICON_GLOBE  = '  (o)  '
const ICON_FLAG   = '  |>>  '

const GLASSES_IDLE_CONTENT = ''
const BREAK_DURATION_MS = 5 * 60 * 1000
const HEAD_DOWN_AXIS_THRESHOLD = -6
const HEAD_DOWN_TRIGGER_SECONDS = 10

const CLICK_EVENT = 0
const SCROLL_TOP_EVENT = 1
const SCROLL_BOTTOM_EVENT = 2
const DOUBLE_CLICK_EVENT = 3
const FOREGROUND_ENTER_EVENT = 4
const FOREGROUND_EXIT_EVENT = 5
const ABNORMAL_EXIT_EVENT = 6

if (!app) throw new Error('Missing #app root element.')

app.innerHTML = `
  <main class="shell">
    <p class="eyebrow">Even G2 — Anchor</p>
    <h1>Anchor</h1>
    <p class="body">
      The startup prompt is on the glasses. Use G2 gestures to choose Yes or No.
    </p>
    <section class="welcome-card choosing" id="welcome-card">
      <p class="welcome-message" id="welcome-message">Glasses prompt: Yes selected.</p>
      <p class="gesture-status" id="gesture-status">Waiting for G2 gesture input...</p>
    </section>
    <section class="event-card">
      <p class="focus-label">Touch events</p>
      <div class="event-feed" id="event-feed">
        <div class="event-feed-item">Waiting for touchpad input...</div>
      </div>
    </section>
    <section class="debug-card">
      <p class="focus-label">Debug log</p>
      <div class="debug-log" id="debug-log">
        <div class="debug-log-item">Waiting for Anchor G2 debug logs...</div>
      </div>
    </section>
    <section class="focus-card" id="focus-card">
      <p class="focus-label">Latest focus check</p>
      <p class="focus-message" id="focus-message">Waiting for Anchor...</p>
      <p class="focus-meta" id="focus-meta">No message yet.</p>
      <div class="focus-history" id="focus-history"></div>
    </section>
    <p class="status" id="status">Waiting for the Even bridge...</p>
  </main>
`

const statusNode = document.querySelector<HTMLParagraphElement>('#status')
const welcomeCard = document.querySelector<HTMLElement>('#welcome-card')
const welcomeMessageNode = document.querySelector<HTMLParagraphElement>('#welcome-message')
const gestureStatusNode = document.querySelector<HTMLParagraphElement>('#gesture-status')
const eventFeedNode = document.querySelector<HTMLDivElement>('#event-feed')
const debugLogNode = document.querySelector<HTMLDivElement>('#debug-log')
const focusCard = document.querySelector<HTMLElement>('#focus-card')
const focusMessageNode = document.querySelector<HTMLParagraphElement>('#focus-message')
const focusMetaNode = document.querySelector<HTMLParagraphElement>('#focus-meta')
const focusHistoryNode = document.querySelector<HTMLDivElement>('#focus-history')

if (
  !statusNode || !welcomeCard || !welcomeMessageNode || !gestureStatusNode ||
  !eventFeedNode || !debugLogNode || !focusCard || !focusMessageNode ||
  !focusMetaNode || !focusHistoryNode
) {
  throw new Error('Missing required Anchor UI elements.')
}

const setStatus = (message: string) => { statusNode.textContent = message }

const touchEventHistory: string[] = []
const debugLogHistory: string[] = []

const renderDebugLog = (message: string, data?: Record<string, unknown>) => {
  const time = new Date().toLocaleTimeString()
  const payload = data ? ` ${JSON.stringify(data)}` : ''
  debugLogHistory.unshift(`${time} ${message}${payload}`)
  while (debugLogHistory.length > 16) debugLogHistory.pop()
  debugLogNode.replaceChildren(
    ...debugLogHistory.map((item) => {
      const row = document.createElement('div')
      row.className = 'debug-log-item'
      row.textContent = item
      return row
    }),
  )
}

const renderTouchEvent = (eventType: number | undefined, containerName: string, source = 'unknown') => {
  const time = new Date().toLocaleTimeString()
  touchEventHistory.unshift(`${time} ${formatEventType(eventType)} from ${containerName} source:${source}`)
  while (touchEventHistory.length > 8) touchEventHistory.pop()
  eventFeedNode.innerHTML = touchEventHistory
    .map((item) => `<div class="event-feed-item">${item}</div>`)
    .join('')
}

const formatEventType = (eventType: number | undefined) => {
  if (eventType === undefined) return 'CLICK_EVENT'
  if (eventType === CLICK_EVENT) return 'CLICK_EVENT'
  if (eventType === SCROLL_TOP_EVENT) return 'SCROLL_TOP_EVENT'
  if (eventType === SCROLL_BOTTOM_EVENT) return 'SCROLL_BOTTOM_EVENT'
  if (eventType === DOUBLE_CLICK_EVENT) return 'DOUBLE_CLICK_EVENT'
  if (eventType === FOREGROUND_ENTER_EVENT) return 'FOREGROUND_ENTER_EVENT'
  if (eventType === FOREGROUND_EXIT_EVENT) return 'FOREGROUND_EXIT_EVENT'
  if (eventType === ABNORMAL_EXIT_EVENT) return 'ABNORMAL_EXIT_EVENT'
  return `event:${eventType}`
}

const isTouchEventType = (eventType: number | undefined) =>
  eventType === undefined ||
  eventType === CLICK_EVENT ||
  eventType === SCROLL_TOP_EVENT ||
  eventType === SCROLL_BOTTOM_EVENT ||
  eventType === DOUBLE_CLICK_EVENT

const logGlassDebug = (message: string, data?: Record<string, unknown>) => {
  renderDebugLog(message, data)
  if (data) { console.log(`[anchor:g2] ${message}`, data); return }
  console.log(`[anchor:g2] ${message}`)
}

// ── Glass content formatters ────────────────────────────────────────────────

const yesNoRow = (selected: 'yes' | 'no') => {
  const y = selected === 'yes' ? '[ Yes ]' : '  Yes  '
  const n = selected === 'no'  ? '[ No  ]' : '  No   '
  return `${y}   ${n}`
}

const formatWelcomeGlassContent = (state: WelcomeState, selectedChoice: WelcomeChoice) => {
  if (state === 'focused') return 'Work session begun'
  if (state === 'starting') return `${ICON_ROBOT}\n\nStarting focus...`
  if (state === 'declined') return `${ICON_ROBOT}\n\nNo problem.\nCome back when ready.`
  return `${ICON_ROBOT}\n\nI'm Anchor.\nReady to focus?\n\n${yesNoRow(selectedChoice)}`
}

const isUserFocused = (message: FocusMessage | null) => message?.userFocused ?? message?.userOnTrack

const getFocusMessageKey = (message: FocusMessage | null) =>
  `${message?.createdAt || ''}:${message?.message || ''}`

const pickDriftIcon = (message: FocusMessage | null) => {
  const text = (message?.message || '').toLowerCase()
  if (
    text.includes('tab') || text.includes('site') || text.includes('browser') ||
    text.includes('relat') || text.includes('project') || text.includes('web')
  ) return ICON_GLOBE
  return ICON_WALK
}

const formatFocusPromptGlassContent = (message: FocusMessage | null, selectedChoice: FocusPromptChoice) => {
  if (!message || isUserFocused(message) !== false) return GLASSES_IDLE_CONTENT
  const icon = pickDriftIcon(message)
  const focusLine = (message.message ?? 'It looks like your focus may have shifted.').slice(0, 72)
  return `${icon}\n\n${focusLine}\nOn purpose?\n\n${yesNoRow(selectedChoice)}`
}

// Yes = "I meant to do this"  No = "I drifted — back on track"
const formatFocusPromptResponseGlassContent = (choice: FocusPromptChoice) =>
  choice === 'yes'
    ? `${ICON_ROBOT}\n\nOk, I'll check\nback in a few.`
    : `${ICON_CLAP}\n\nGood reset!\nBack on track.`

const formatBreakGlassContent = (remainingMs: number) => {
  const secs = Math.max(0, Math.ceil(remainingMs / 1000))
  const m = Math.floor(secs / 60).toString().padStart(2, '0')
  const s = (secs % 60).toString().padStart(2, '0')
  return `${ICON_COFFEE}\n\n5 mins break\n    ${m}:${s}`
}

const formatBreakOverGlassContent = (selected: 'yes' | 'no') =>
  `${ICON_BELL}\n\nBreak over.\nBack to focus?\n\n${yesNoRow(selected)}`

const formatSessionEndGlassContent = (summary: SessionSummary) => {
  const f = (n: number, w: number) => String(n).padStart(w)
  return [
    ICON_FLAG,
    '',
    'Session done!',
    '',
    `Focus  ${f(summary.focus_minutes, 3)}/${summary.total_minutes} min`,
    `Drifts      ${f(summary.drift_count, 4)}`,
    `On track    ${f(summary.back_on_track_count, 4)}`,
    `Score       ${f(summary.focus_score, 3)}%`,
  ].join('\n')
}

const renderWelcome = (state: WelcomeState, selectedChoice: WelcomeChoice) => {
  welcomeCard.className = `welcome-card ${state}`
  if (state === 'focused') {
    welcomeMessageNode.textContent = 'Glasses prompt: Work session begun.'
    gestureStatusNode.textContent = 'Confirmed Yes.'
  } else if (state === 'starting') {
    welcomeMessageNode.textContent = 'Glasses prompt: starting focus...'
    gestureStatusNode.textContent = 'Creating your focus session...'
  } else if (state === 'declined') {
    welcomeMessageNode.textContent = 'Glasses prompt: no problem.'
    gestureStatusNode.textContent = 'Confirmed No. Anchor will stay idle.'
  } else {
    welcomeMessageNode.textContent = `Glasses prompt: ${selectedChoice === 'yes' ? 'Yes' : 'No'} selected.`
    gestureStatusNode.textContent = 'Swipe up for Yes, swipe down for No, press to confirm.'
  }
}

const renderFocusMessage = (message: FocusMessage | null) => {
  const userFocused = isUserFocused(message)
  focusCard.classList.toggle('off-track', userFocused === false)
  focusCard.classList.toggle('on-track', userFocused === true)
  focusMessageNode.textContent = message?.message || 'Waiting for Anchor...'
  focusMetaNode.textContent = message?.createdAt
    ? `${message.status || 'ok'} · ${new Date(message.createdAt).toLocaleTimeString()}`
    : 'No message yet.'
}

const renderNoActiveSession = () => {
  focusCard.classList.remove('off-track', 'on-track')
  focusMessageNode.textContent = 'Start a focus session to show Anchor messages.'
  focusMetaNode.textContent = 'Message polling paused.'
}

const messageHistory: FocusMessage[] = []
let lastRenderedMessageKey = ''

const trackMessageChange = (message: FocusMessage | null) => {
  if (!message?.message) return
  const key = `${message.createdAt || ''}:${message.message}`
  if (key === lastRenderedMessageKey) return
  lastRenderedMessageKey = key
  messageHistory.unshift(message)
  while (messageHistory.length > 4) messageHistory.pop()
  focusHistoryNode.innerHTML = messageHistory
    .map((item) => {
      const time = item.createdAt ? new Date(item.createdAt).toLocaleTimeString() : ''
      return `<div class="focus-history-item">${time} ${item.message}</div>`
    })
    .join('')
}

// ── API calls ───────────────────────────────────────────────────────────────

const fetchLatestFocusMessage = async () => {
  const response = await fetch(`${ANCHOR_API_ORIGIN}/messages/latest`)
  if (!response.ok) throw new Error(`Anchor message fetch failed: ${response.status}`)
  const message = (await response.json()) as FocusMessage
  return message.message ? message : null
}

const fetchCurrentSession = async () => {
  const response = await fetch(`${ANCHOR_API_ORIGIN}/session/current`)
  if (!response.ok) return null
  const session = (await response.json()) as FocusSession
  return session?.intent ? session : null
}

const fetchSessionSummary = async (): Promise<SessionSummary | null> => {
  try {
    const response = await fetch(`${ANCHOR_API_ORIGIN}/session/summary`)
    if (!response.ok) return null
    return (await response.json()) as SessionSummary
  } catch { return null }
}

const startFocusSession = async () => {
  const response = await fetch(`${ANCHOR_API_ORIGIN}/session/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ intent: 'work/study', mode: 'deep' }),
  })
  if (!response.ok) throw new Error(`Unable to start focus session: ${response.status}`)
}

const clearFocusMessage = async () => {
  const response = await fetch(`${ANCHOR_API_ORIGIN}/messages/clear`, { method: 'POST' })
  if (!response.ok) throw new Error(`Unable to clear focus message: ${response.status}`)
}

// ── Bootstrap ───────────────────────────────────────────────────────────────

async function bootstrap() {
  try {
    const bridge = await waitForEvenAppBridge()
    setStatus('Bridge connected. Rendering to the glasses...')

    let latestFocusMessage: FocusMessage | null = null
    let activeSessionId: number | null = null
    let messagePollInterval: number | null = null
    let inactiveRendered = false

    let welcomeState: WelcomeState = 'choosing'
    let selectedWelcomeChoice: WelcomeChoice = 'yes'
    let welcomeResolved = false
    let focusMessagesVisibleAfter = Number.POSITIVE_INFINITY

    let focusPromptState: FocusPromptState = 'idle'
    let selectedFocusPromptChoice: FocusPromptChoice = 'yes'
    let activeFocusPromptMessageKey = ''
    let dismissedFocusPromptMessageKey = ''

    let breakState: BreakState = 'idle'
    let breakEndsAt = 0
    let breakTimerInterval: number | null = null
    let breakOverState: BreakOverState = 'idle'
    let selectedBreakOverChoice: 'yes' | 'no' = 'yes'

    let sessionEndState: SessionEndState = 'idle'

    let imuSignalPostInFlight = false

    const initialWelcomeContent = formatWelcomeGlassContent(welcomeState, selectedWelcomeChoice)
    const helloWorld: TextContainerProperty = {
      xPosition: 0,
      yPosition: 0,
      width: 488,
      height: 220,
      borderWidth: 0,
      paddingLength: 12,
      containerID: 1,
      containerName: 'hello',
      content: initialWelcomeContent,
      isEventCapture: 1,
    }

    const result = await bridge.createStartUpPageContainer({
      containerTotalNum: 1,
      textObject: [helloWorld],
    })

    if (result !== 0) {
      setStatus(`The bridge connected, but page creation failed with code ${result}.`)
      return
    }

    // Queue-based write: skip duplicates, hold one pending write while in-flight.
    let glassWriteInFlight = false
    let lastGlassContent = initialWelcomeContent
    let queuedGlassContent: string | null = null

    const writeGlasses = async (content: string) => {
      if (content === lastGlassContent && queuedGlassContent === null) {
        logGlassDebug('skipping duplicate glasses content', { content })
        return
      }
      if (glassWriteInFlight) {
        queuedGlassContent = content
        logGlassDebug('queued glasses content while write is in flight', { content })
        return
      }
      glassWriteInFlight = true
      try {
        let nextContent: string | null = content
        while (nextContent !== null) {
          const contentToWrite = nextContent
          queuedGlassContent = null
          logGlassDebug('writing glasses content', { content: contentToWrite })
          await bridge.textContainerUpgrade(
            new TextContainerUpgrade({ containerID: 1, containerName: 'hello', content: contentToWrite }),
          )
          lastGlassContent = contentToWrite
          logGlassDebug('glasses content write complete', { content: contentToWrite })
          nextContent = queuedGlassContent
          if (nextContent === lastGlassContent) { queuedGlassContent = null; nextContent = null }
        }
      } catch (err) {
        console.warn('textContainerUpgrade failed', err)
      } finally {
        glassWriteInFlight = false
      }
    }

    // ── Welcome flow ─────────────────────────────────────────────────────────

    const updateWelcomeState = async (state: WelcomeState) => {
      logGlassDebug('welcome state transition', { from: welcomeState, to: state, selectedWelcomeChoice })
      welcomeState = state
      renderWelcome(state, selectedWelcomeChoice)
      await writeGlasses(formatWelcomeGlassContent(welcomeState, selectedWelcomeChoice))
    }

    const updateWelcomeSelection = async (choice: WelcomeChoice) => {
      if (welcomeResolved) { logGlassDebug('ignored selection because welcome is resolved', { choice }); return }
      if (selectedWelcomeChoice === choice) { logGlassDebug('ignored duplicate welcome selection', { choice }); return }
      selectedWelcomeChoice = choice
      renderWelcome(welcomeState, selectedWelcomeChoice)
      await writeGlasses(formatWelcomeGlassContent(welcomeState, selectedWelcomeChoice))
    }

    const handleWelcomeGesture = async (eventType: number | undefined) => {
      if (welcomeResolved) { logGlassDebug('ignored gesture because welcome is resolved'); return }
      const norm = eventType ?? CLICK_EVENT
      logGlassDebug('handling welcome gesture', { norm, selectedWelcomeChoice })
      if (norm === SCROLL_TOP_EVENT) { await updateWelcomeSelection('yes'); return }
      if (norm === SCROLL_BOTTOM_EVENT) { await updateWelcomeSelection('no'); return }
      if (norm === CLICK_EVENT) { selectedWelcomeChoice = 'yes'; await handleWelcomeChoice('yes'); return }
      if (norm === DOUBLE_CLICK_EVENT) { selectedWelcomeChoice = 'no'; await handleWelcomeChoice('no') }
    }

    const handleWelcomeChoice = async (choice: WelcomeChoice) => {
      if (welcomeResolved) { logGlassDebug('ignored choice because welcome is resolved'); return }
      logGlassDebug('welcome choice confirmed', { choice })
      welcomeResolved = true
      if (choice === 'no') { await updateWelcomeState('declined'); return }
      focusMessagesVisibleAfter = performance.now() + 5_000
      await updateWelcomeState('starting')
      try {
        await startFocusSession()
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to start focus session.'
        setStatus(message)
        logGlassDebug('focus session start failed', { message })
        return
      }
      await updateWelcomeState('focused')
      window.setTimeout(() => {
        void writeGlasses(GLASSES_IDLE_CONTENT)
        void syncSessionState()
      }, 5_000)
    }

    // ── Session polling ───────────────────────────────────────────────────────

    const syncSessionState = async () => {
      try {
        const session = await fetchCurrentSession()
        if (!session) { await stopMessagePolling(); return }
        await startMessagePolling(session)
      } catch {
        await stopMessagePolling()
      }
    }

    const startMessagePolling = async (session: FocusSession) => {
      if (session.id === activeSessionId && messagePollInterval !== null) return
      activeSessionId = session.id ?? null
      inactiveRendered = false
      await refreshFocusMessage()
      messagePollInterval = window.setInterval(() => { void refreshFocusMessage() }, 15_000)
    }

    const stopMessagePolling = async () => {
      if (messagePollInterval !== null) { window.clearInterval(messagePollInterval); messagePollInterval = null }
      const wasActive = activeSessionId !== null && welcomeState === 'focused'
      if (inactiveRendered && activeSessionId === null && latestFocusMessage === null) return
      activeSessionId = null
      latestFocusMessage = null
      inactiveRendered = true
      dismissedFocusPromptMessageKey = ''
      stopBreakTimer()
      breakState = 'idle'
      breakEndsAt = 0
      breakOverState = 'idle'
      renderNoActiveSession()
      if (wasActive) {
        const summary = await fetchSessionSummary()
        if (summary && summary.total_minutes > 0) {
          sessionEndState = 'showing'
          await writeGlasses(formatSessionEndGlassContent(summary))
          window.setTimeout(() => {
            sessionEndState = 'idle'
            void writeGlasses(GLASSES_IDLE_CONTENT)
          }, 15_000)
          return
        }
      }
      await writeGlasses(GLASSES_IDLE_CONTENT)
    }

    const refreshFocusMessage = async () => {
      try {
        latestFocusMessage = await fetchLatestFocusMessage()
        const latestMessageKey = getFocusMessageKey(latestFocusMessage)
        if (latestFocusMessage && latestMessageKey === dismissedFocusPromptMessageKey) {
          latestFocusMessage = null
          renderFocusMessage(null)
          logGlassDebug('skipping dismissed focus message')
          return
        }
        renderFocusMessage(latestFocusMessage)
        trackMessageChange(latestFocusMessage)
        if (focusPromptState !== 'idle' || breakState === 'active' ||
            breakOverState === 'asking' || sessionEndState === 'showing') return
        if (isUserFocused(latestFocusMessage) === false) {
          const messageKey = getFocusMessageKey(latestFocusMessage)
          if (messageKey !== activeFocusPromptMessageKey) {
            focusPromptState = 'asking'
            selectedFocusPromptChoice = 'yes'
            activeFocusPromptMessageKey = messageKey
            await writeGlasses(formatFocusPromptGlassContent(latestFocusMessage, selectedFocusPromptChoice))
          }
        } else {
          focusPromptState = 'idle'
          activeFocusPromptMessageKey = ''
          await writeGlasses(GLASSES_IDLE_CONTENT)
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to fetch Anchor message.'
        latestFocusMessage = { userOnTrack: false, message, status: 'fetch_error' }
        renderFocusMessage(latestFocusMessage)
        if (focusPromptState !== 'idle' || breakState === 'active' ||
            breakOverState === 'asking' || sessionEndState === 'showing') return
        focusPromptState = 'asking'
        selectedFocusPromptChoice = 'yes'
        activeFocusPromptMessageKey = getFocusMessageKey(latestFocusMessage)
        await writeGlasses(formatFocusPromptGlassContent(latestFocusMessage, selectedFocusPromptChoice))
      }
    }

    // ── Drift / focus prompt flow ─────────────────────────────────────────────

    const updateFocusPromptSelection = async (choice: FocusPromptChoice) => {
      if (focusPromptState !== 'asking' || selectedFocusPromptChoice === choice) return
      selectedFocusPromptChoice = choice
      await writeGlasses(formatFocusPromptGlassContent(latestFocusMessage, choice))
    }

    const handleFocusPromptChoice = async (choice: FocusPromptChoice) => {
      if (focusPromptState !== 'asking') return
      focusPromptState = 'answered'
      dismissedFocusPromptMessageKey = activeFocusPromptMessageKey
      latestFocusMessage = null
      renderFocusMessage(null)
      logGlassDebug('focus prompt choice confirmed', { choice })
      await writeGlasses(formatFocusPromptResponseGlassContent(choice))
      try { await clearFocusMessage() } catch (e) { logGlassDebug('clear message failed', { e }) }
      window.setTimeout(() => { focusPromptState = 'idle'; void writeGlasses(GLASSES_IDLE_CONTENT) }, 5_000)
    }

    const handleFocusPromptGesture = async (eventType: number | undefined) => {
      const norm = eventType ?? CLICK_EVENT
      if (norm === SCROLL_TOP_EVENT) { await updateFocusPromptSelection('yes'); return }
      if (norm === SCROLL_BOTTOM_EVENT) { await updateFocusPromptSelection('no'); return }
      if (norm === CLICK_EVENT) { await handleFocusPromptChoice(selectedFocusPromptChoice); return }
      if (norm === DOUBLE_CLICK_EVENT) { await handleFocusPromptChoice('no') }
    }

    // ── Break flow ────────────────────────────────────────────────────────────

    const stopBreakTimer = () => {
      if (breakTimerInterval !== null) { window.clearInterval(breakTimerInterval); breakTimerInterval = null }
    }

    const renderBreakState = async () => {
      await writeGlasses(formatBreakGlassContent(breakEndsAt - performance.now()))
    }

    const exitBreak = async () => {
      if (breakState !== 'active') { logGlassDebug('ignored break exit — not active'); return }
      stopBreakTimer()
      breakState = 'idle'
      breakEndsAt = 0
      breakOverState = 'asking'
      selectedBreakOverChoice = 'yes'
      await writeGlasses(formatBreakOverGlassContent('yes'))
    }

    const startBreak = async () => {
      if (breakState === 'active') { logGlassDebug('break already active'); return }
      if (focusPromptState === 'asking') { logGlassDebug('cannot start break while prompt is active'); return }
      if (welcomeState !== 'focused') { logGlassDebug('cannot start break — no active session'); return }
      breakState = 'active'
      breakEndsAt = performance.now() + BREAK_DURATION_MS
      focusPromptState = 'idle'
      activeFocusPromptMessageKey = ''
      await renderBreakState()
      stopBreakTimer()
      breakTimerInterval = window.setInterval(() => {
        if (breakState !== 'active') return
        if (performance.now() >= breakEndsAt) { void exitBreak(); return }
        void renderBreakState()
      }, 1_000)
    }

    const handleBreakOverGesture = async (eventType: number | undefined) => {
      const norm = eventType ?? CLICK_EVENT
      if (norm === SCROLL_TOP_EVENT) {
        selectedBreakOverChoice = 'yes'
        await writeGlasses(formatBreakOverGlassContent('yes'))
        return
      }
      if (norm === SCROLL_BOTTOM_EVENT) {
        selectedBreakOverChoice = 'no'
        await writeGlasses(formatBreakOverGlassContent('no'))
        return
      }
      if (norm === CLICK_EVENT || norm === DOUBLE_CLICK_EVENT) {
        breakOverState = 'idle'
        logGlassDebug('break-over resolved', { choice: selectedBreakOverChoice })
        if (selectedBreakOverChoice === 'no') {
          void startBreak()
        } else {
          await writeGlasses(GLASSES_IDLE_CONTENT)
        }
      }
    }

    // ── Gesture router ────────────────────────────────────────────────────────

    const handleTouchGesture = async (eventType: number | undefined) => {
      if (!welcomeResolved) { await handleWelcomeGesture(eventType); return }
      const norm = eventType ?? CLICK_EVENT
      if (sessionEndState === 'showing') {
        if (norm === CLICK_EVENT) { sessionEndState = 'idle'; await writeGlasses(GLASSES_IDLE_CONTENT) }
        return
      }
      if (breakOverState === 'asking') { await handleBreakOverGesture(eventType); return }
      if (breakState === 'active') {
        if (norm === CLICK_EVENT) { await exitBreak(); return }
        return
      }
      if (focusPromptState === 'asking') { await handleFocusPromptGesture(eventType); return }
      if (norm === DOUBLE_CLICK_EVENT) { await startBreak(); return }
      logGlassDebug('ignored quiet-focus gesture', { eventType: norm })
    }

    renderWelcome(welcomeState, selectedWelcomeChoice)
    window.setInterval(() => {
      if (welcomeResolved && welcomeState === 'focused' && performance.now() >= focusMessagesVisibleAfter) {
        void syncSessionState()
      }
    }, 5_000)

    // ── IMU / motion stream ───────────────────────────────────────────────────
    // Distraction heuristic — calibrated against real glasses (see imu_ref.md)
    const STILL_THRESHOLD = 0.02
    const WINDOW_MS = 60_000
    const MOVING_FRAC_TRIGGER = 0.7
    const MIN_SAMPLES = 30
    const IMU_POST_INTERVAL_MS = 5_000

    let prev: { x: number; y: number; z: number } | null = null
    const samples: { t: number; energy: number }[] = []
    let headDownStartedAt: number | null = null
    let lastImuPostAt = 0
    let lastPostedMode: 'Focus' | 'Distracted' | null = null

    const postMotionEvent = (payload: ImuState & { summary: string }) => {
      if (imuSignalPostInFlight) return
      imuSignalPostInFlight = true
      fetch(`${ANCHOR_API_ORIGIN}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'g2', type: 'motion', payload }),
      }).finally(() => { imuSignalPostInFlight = false })
    }

    bridge.onEvenHubEvent((event) => {
      if (event.textEvent || event.listEvent) {
        const eventType = event.textEvent?.eventType ?? event.listEvent?.eventType
        const containerName = event.textEvent?.containerName ?? event.listEvent?.containerName ?? 'unknown'
        const source = event.sysEvent?.eventSource ? String(event.sysEvent.eventSource) : 'touchpad'
        logGlassDebug('captured input event', { eventType: formatEventType(eventType), containerName, source })
        renderTouchEvent(eventType, containerName, source)
        setStatus(`Input event: ${formatEventType(eventType)} from ${containerName}`)
        void handleTouchGesture(eventType)
      }

      const sys = event.sysEvent
      if (!sys || sys.eventType !== OsEventTypeList.IMU_DATA_REPORT || !sys.imuData) {
        if (event.textEvent || event.listEvent) return
        if (sys?.eventType !== undefined) {
          const source = sys.eventSource ? String(sys.eventSource) : 'system'
          logGlassDebug('system event', { eventType: formatEventType(sys.eventType), source })
          renderTouchEvent(sys.eventType, 'system', source)
          setStatus(`System event: ${formatEventType(sys.eventType)} source:${source}`)
          if (isTouchEventType(sys.eventType)) void handleTouchGesture(sys.eventType)
          return
        }
        if (event.jsonData) {
          logGlassDebug('raw jsonData event')
          renderTouchEvent(undefined, 'jsonData', 'raw')
          setStatus('Raw jsonData event received. See console.')
          void handleTouchGesture(sys?.eventType)
          return
        }
        console.log('even event', event)
        setStatus('Even non-IMU event received. See console.')
        return
      }

      const x = sys.imuData.x ?? 0
      const y = sys.imuData.y ?? 0
      const z = sys.imuData.z ?? 0

      let energy = 0
      if (prev) {
        const dx = x - prev.x; const dy = y - prev.y; const dz = z - prev.z
        energy = Math.sqrt(dx * dx + dy * dy + dz * dz)
      }
      prev = { x, y, z }

      const now = performance.now()
      const possibleHeadDown = y <= HEAD_DOWN_AXIS_THRESHOLD
      if (possibleHeadDown && headDownStartedAt === null) headDownStartedAt = now
      else if (!possibleHeadDown) headDownStartedAt = null
      const headDownSeconds = headDownStartedAt === null ? 0 : (now - headDownStartedAt) / 1000

      samples.push({ t: now, energy })
      while (samples.length > 0 && now - samples[0]!.t > WINDOW_MS) samples.shift()

      let mode: 'Focus' | 'Distracted' = 'Focus'
      let movingFrac = 0
      if (samples.length >= MIN_SAMPLES) {
        const movingCount = samples.filter((s) => s.energy > STILL_THRESHOLD).length
        movingFrac = movingCount / samples.length
        if (movingFrac > MOVING_FRAC_TRIGGER) mode = 'Distracted'
      }

      const modeFlipped = lastPostedMode !== null && mode !== lastPostedMode
      const intervalElapsed = now - lastImuPostAt >= IMU_POST_INTERVAL_MS
      if ((intervalElapsed || modeFlipped) && !imuSignalPostInFlight) {
        lastImuPostAt = now
        lastPostedMode = mode
        const movingPct = Math.round(movingFrac * 100)
        const headNote = possibleHeadDown ? `, head-down ${headDownSeconds.toFixed(0)}s` : ''
        const summary = mode === 'Focus'
          ? `Head still (Focus, ${movingPct}% moving${headNote})`
          : `Sustained movement (Distracted, ${movingPct}% moving${headNote})`
        postMotionEvent({ mode, energy, movingFrac, possibleHeadDown, headDownSeconds, x, y, z, summary })
      }
    })

    await bridge.imuControl(true, ImuReportPace.P100)
    setStatus('G2 touch ready. IMU streaming in the background.')
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    setStatus(`Failed to initialize the Even bridge: ${message}`)
  }
}

void bootstrap()
