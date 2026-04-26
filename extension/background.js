const AGENT_URL = 'http://localhost:8000/events';

let activeTab = { domain: null, startedAt: null };

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

function flushActiveTab() {
  if (!activeTab.domain || !activeTab.startedAt) return;
  const duration_sec = (Date.now() - activeTab.startedAt) / 1000;
  if (duration_sec < 2) return; // skip sub-2s flickers
  postEvent('tab_change', { domain: activeTab.domain, duration_sec });
}

chrome.tabs.onActivated.addListener(async (info) => {
  flushActiveTab();
  const tab = await chrome.tabs.get(info.tabId);
  const domain = extractDomain(tab.url);
  activeTab = { domain, startedAt: Date.now() };
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0] || tabs[0].id !== tabId) return;
    flushActiveTab();
    const domain = extractDomain(tab.url);
    activeTab = { domain, startedAt: Date.now() };
  });
});

// Flush current tab every 60s so long dwell times are reported
chrome.alarms.create('heartbeat', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== 'heartbeat') return;
  if (!activeTab.domain) return;
  const duration_sec = (Date.now() - activeTab.startedAt) / 1000;
  postEvent('tab_change', { domain: activeTab.domain, duration_sec });
  // Reset start time so next heartbeat reports incremental time
  activeTab.startedAt = Date.now();
});
