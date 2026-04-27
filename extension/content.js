// Runs inside every page — extracts a brief summary and sends it to the background worker

function extractSummary() {
  const get = (selector, attr = 'content') => {
    const el = document.querySelector(selector);
    return el ? (attr === 'text' ? el.textContent?.trim() : el?.getAttribute(attr)?.trim()) : null;
  };

  const title = document.title?.trim() || '';

  const description =
    get('meta[name="description"]') ||
    get('meta[property="og:description"]') ||
    get('meta[name="twitter:description"]') ||
    '';

  const heading = get('h1', 'text') || get('h2', 'text') || '';

  // Truncate to keep payload small
  const summary = [
    title.slice(0, 120),
    description.slice(0, 160),
    heading !== title ? heading.slice(0, 80) : '',
  ]
    .filter(Boolean)
    .join(' | ');

  return summary.slice(0, 300);
}

// Send summary to background on page load
chrome.runtime.sendMessage({
  type: 'page_summary',
  summary: extractSummary(),
  url: location.href,
});
