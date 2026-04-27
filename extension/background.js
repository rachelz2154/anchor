const ANCHOR_ORIGIN = 'http://localhost:8000';
const AGENT_URL = `${ANCHOR_ORIGIN}/events`;

// Domains/patterns to ignore entirely — not meaningful activity
const SKIP_DOMAINS = new Set(['newtab', 'extensions', 'settings', '', 'localhost', '127.0.0.1']);
const SKIP_PROTOCOLS = ['chrome:', 'chrome-extension:', 'about:', 'edge:', 'moz-extension:'];

let activeTab = { domain: null, title: null, path: null, summary: null, startedAt: null };

function extractDomain(url) {
  try {
    const u = new URL(url);
    if (SKIP_PROTOCOLS.some(p => u.protocol.startsWith(p))) return null;
    return u.hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

function extractPath(url) {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/$/, '');
    const query = u.searchParams.toString();
    return query ? `${path}?${query.slice(0, 80)}` : path;
  } catch {
    return '';
  }
}

function shouldSkip(domain) {
  return !domain || SKIP_DOMAINS.has(domain);
}

async function postEvent(type, payload) {
  try {
    await fetch(AGENT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'chrome', type, payload }),
    });
  } catch {
    // Agent not running — silently ignore
  }
}

async function getCurrentSession() {
  try {
    const response = await fetch(`${ANCHOR_ORIGIN}/session/current`);
    if (!response.ok) return null;
    const session = await response.json();
    return session && session.intent ? session : null;
  } catch {
    return null;
  }
}

async function saveState() {
  await chrome.storage.session.set({ activeTab });
}

async function restoreState() {
  const data = await chrome.storage.session.get('activeTab');
  if (data.activeTab && data.activeTab.domain) {
    activeTab = data.activeTab;
  } else {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.url) await setActiveTab(tab);
  }
}

async function flushActiveTab() {
  if (shouldSkip(activeTab.domain) || !activeTab.startedAt) return;
  const endedAt = Date.now();
  const duration_sec = Math.round((endedAt - activeTab.startedAt) / 1000);
  if (duration_sec < 2) return;
  await postEvent('tab_change', {
    domain: activeTab.domain,
    title: activeTab.title || '',
    path: activeTab.path || '',
    summary: activeTab.summary || '',
    duration_sec,
    eventStartedAt: new Date(activeTab.startedAt).toISOString(),
    eventEndedAt: new Date(endedAt).toISOString(),
    observedAt: new Date(endedAt).toISOString(),
  });
}

async function setActiveTab(tab) {
  const domain = extractDomain(tab.url);
  if (shouldSkip(domain)) return;
  activeTab = {
    domain,
    title: tab.title || '',
    path: extractPath(tab.url),
    summary: null,   // filled in when content script fires
    startedAt: Date.now(),
  };
  await saveState();
}

async function captureOpenTabsSnapshot() {
  const session = await getCurrentSession();
  if (!session) return;
  chrome.tabs.query({}, async (tabs) => {
    const openTabs = tabs.map((tab) => ({
      domain: extractDomain(tab.url),
      title: tab.title || '',
      active: Boolean(tab.active),
      windowId: tab.windowId || 0,
    })).filter((tab) => tab.domain && !shouldSkip(tab.domain));
    try {
      const response = await fetch(`${ANCHOR_ORIGIN}/firestore/tab-snapshot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: {
          source: 'chrome',
          sessionId: session.id || session.session_id || session.sessionId,
          sessionIntent: session.intent,
          sessionMode: session.mode || 'deep',
          openTabs,
          createdAt: new Date().toISOString(),
        } }),
      });
      if (!response.ok) throw new Error(await response.text());
    } catch (error) {
      console.warn('Anchor Firestore tab snapshot failed', error);
    }
  });
}

// ── Content script messages ────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type !== 'page_summary') return;
  try {
    const msgDomain = extractDomain(msg.url);
    if (msgDomain === activeTab.domain && msg.summary) {
      activeTab.summary = msg.summary;
      saveState();
    }
  } catch {}
});

// ── Event listeners ────────────────────────────────────────────────────────

chrome.runtime.onStartup.addListener(restoreState);
chrome.runtime.onInstalled.addListener(restoreState);

chrome.tabs.onActivated.addListener(async (info) => {
  await restoreState();
  await flushActiveTab();
  const tab = await chrome.tabs.get(info.tabId);
  await setActiveTab(tab);
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!active || active.id !== tabId) return;

  await restoreState();
  const newDomain = extractDomain(tab.url);
  if (!shouldSkip(newDomain) && newDomain !== activeTab.domain) {
    await flushActiveTab();
  }
  await setActiveTab(tab);
});

// Fast heartbeat: post active tab every 10s so dashboard feels live
// (MV3 alarms can't go below 1 min; setInterval wakes the service worker more often)
setInterval(async () => {
  await restoreState();
  if (shouldSkip(activeTab.domain) || !activeTab.startedAt) return;
  const duration_sec = Math.round((Date.now() - activeTab.startedAt) / 1000);
  await postEvent('tab_active', {
    domain: activeTab.domain,
    title: activeTab.title || '',
    path: activeTab.path || '',
    duration_sec,
  });
}, 10_000);

// Slow heartbeat: cumulative dwell + Firestore tab snapshot every 60s
chrome.alarms.create('heartbeat', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== 'heartbeat') return;
  await restoreState();
  if (shouldSkip(activeTab.domain) || !activeTab.startedAt) return;
  const duration_sec = Math.round((Date.now() - activeTab.startedAt) / 1000);
  const observedAt = Date.now();
  await postEvent('tab_change', {
    domain: activeTab.domain,
    title: activeTab.title || '',
    path: activeTab.path || '',
    duration_sec,
    heartbeat: true,
    eventStartedAt: new Date(activeTab.startedAt).toISOString(),
    eventEndedAt: new Date(observedAt).toISOString(),
    observedAt: new Date(observedAt).toISOString(),
  });
  await captureOpenTabsSnapshot();
});
