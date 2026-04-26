const ANCHOR_ORIGIN = 'http://localhost:8000';
const AGENT_URL = `${ANCHOR_ORIGIN}/events`;

let activeTab = { domain: null, title: '', url: '', tabId: null, windowId: null, startedAt: null };

function extractDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
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

async function writeLiveSignal(type, payload) {
  const session = await getCurrentSession();
  if (!session) return;
  await postEvent(type, payload);
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
    })).filter((tab) => tab.domain);
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

async function flushActiveTab() {
  if (!activeTab.domain || !activeTab.startedAt) return;
  const durationSec = (Date.now() - activeTab.startedAt) / 1000;
  if (durationSec < 2) return; // skip sub-2s flickers
  const payload = {
    domain: activeTab.domain,
    title: activeTab.title || '',
    tabId: activeTab.tabId || 0,
    windowId: activeTab.windowId || 0,
    durationSec,
    duration_sec: durationSec,
  };
  await writeLiveSignal('tab_change', payload);
}

chrome.tabs.onActivated.addListener(async (info) => {
  await flushActiveTab();
  const tab = await chrome.tabs.get(info.tabId);
  const domain = extractDomain(tab.url);
  activeTab = {
    domain,
    title: tab.title || '',
    url: tab.url || '',
    tabId: tab.id || null,
    windowId: tab.windowId || null,
    startedAt: Date.now(),
  };
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
    if (!tabs[0] || tabs[0].id !== tabId) return;
    await flushActiveTab();
    const domain = extractDomain(tab.url);
    activeTab = {
      domain,
      title: tab.title || '',
      url: tab.url || '',
      tabId: tab.id || null,
      windowId: tab.windowId || null,
      startedAt: Date.now(),
    };
  });
});

// Flush current tab every 60s so long dwell times are reported
chrome.alarms.create('heartbeat', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== 'heartbeat') return;
  if (!activeTab.domain) return;
  await flushActiveTab();
  await captureOpenTabsSnapshot();
  // Reset start time so next heartbeat reports incremental time
  activeTab.startedAt = Date.now();
});

async function initializeActiveTab() {
  chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
    const tab = tabs[0];
    if (!tab) return;
    activeTab = {
      domain: extractDomain(tab.url),
      title: tab.title || '',
      url: tab.url || '',
      tabId: tab.id || null,
      windowId: tab.windowId || null,
      startedAt: Date.now(),
    };
    await captureOpenTabsSnapshot();
  });
}

chrome.runtime.onStartup.addListener(initializeActiveTab);
chrome.runtime.onInstalled.addListener(initializeActiveTab);
initializeActiveTab();
