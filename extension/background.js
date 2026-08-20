/**
 * Background — Resume Attach companion (Simplify fills forms; we attach tracker PDF).
 */

const ENGINE_VERSION = 21;
const API_BASE = 'http://127.0.0.1:5002';
/** Attach-only — do not inject content/ats/* (those files were removed). */
const CONTENT_FILES = ['content/attach.js'];

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

async function getTargetTab(preferredTabId) {
  if (preferredTabId != null) {
    try {
      const tab = await chrome.tabs.get(preferredTabId);
      if (tab?.id) return tab;
    } catch {
      /* fall through */
    }
  }
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  let tab = tabs.find((t) => t.url && /^https?:/i.test(t.url));
  if (!tab) {
    const all = await chrome.tabs.query({ lastFocusedWindow: true });
    tab =
      all.find((t) => t.active && t.url && /^https?:/i.test(t.url)) ||
      all.find((t) => t.url && /^https?:/i.test(t.url));
  }
  return tab || tabs[0];
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function readEngineVersion(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => window.__rmAttachVersion || window.__rmFillVersion || 0,
    });
    return Math.max(0, ...(results || []).map((r) => Number(r.result) || 0));
  } catch {
    return 0;
  }
}

async function ensureContentScripts(tabId) {
  const ver = await readEngineVersion(tabId);
  if (ver >= ENGINE_VERSION) return { injected: false, version: ver };
  await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    files: CONTENT_FILES,
  });
  await sleep(80);
  return { injected: true, version: await readEngineVersion(tabId) };
}

/**
 * Run attach/meta in every frame (ATS widgets often live in iframes).
 * Prefer the first ok:true result for attach.
 */
async function runInAllFrames(tabId, message) {
  await ensureContentScripts(tabId);
  const results = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    world: 'ISOLATED',
    func: async (msg) => {
      const handler = window.__rmAttachHandler;
      if (typeof handler !== 'function') return { ok: false, error: 'attach script missing' };
      return handler(msg);
    },
    args: [message],
  });

  const payloads = (results || []).map((r) => r.result).filter(Boolean);
  if (message.type === 'RM_ATTACH_RESUME') {
    const ok = payloads.find((p) => p && p.ok);
    if (ok) return ok;
    const fail = payloads.find((p) => p && p.ok === false);
    if (fail) return fail;
    return { ok: false, error: 'No frame accepted the resume file' };
  }
  if (message.type === 'RM_SCAN_APPLICATION_QUESTIONS') {
    let best = { ok: true, questions: [] };
    for (const p of payloads) {
      if (p?.questions?.length > best.questions.length) best = p;
    }
    return best;
  }
  if (message.type === 'RM_FILL_APPLICATION_ANSWER') {
    const ok = payloads.find((p) => p && p.ok);
    if (ok) return ok;
    const fail = payloads.find((p) => p && p.ok === false);
    if (fail) return fail;
    return { ok: false, error: 'Could not fill answer in any frame' };
  }
  // Prefer main-frame-ish first result with url/title
  return payloads.find((p) => p && (p.url || p.title || p.h1)) || payloads[0] || { ok: false, error: 'No response' };
}

async function runWithRetry(tabId, message, attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await runInAllFrames(tabId, message);
    } catch (err) {
      lastErr = err;
      await sleep(150 * (i + 1));
    }
  }
  throw lastErr || new Error('Tab action failed — refresh the job page and retry');
}

async function fetchPdfAsBase64(pdfUrl) {
  const res = await fetch(pdfUrl);
  if (!res.ok) throw new Error(`PDF fetch ${res.status} from backend`);
  const buf = await res.arrayBuffer();
  if (!buf.byteLength) throw new Error('PDF is empty');
  if (buf.byteLength > 12 * 1024 * 1024) throw new Error('PDF too large (>12MB)');
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x2000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return { base64: btoa(binary), byteLength: bytes.length };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    if (message?.type === 'PING') {
      sendResponse({ ok: true, engine: ENGINE_VERSION });
      return;
    }

    if (message?.type === 'RUN_ON_TAB') {
      const tab = await getTargetTab(message.tabId);
      if (!tab?.id) throw new Error('No active tab');
      if (!tab.url || /^(chrome|chrome-extension|edge|about):/i.test(tab.url)) {
        throw new Error('Open an application page first');
      }

      const inject = await ensureContentScripts(tab.id);
      let payload = message.payload || {};

      if (message.action === 'RM_ATTACH_RESUME' && payload.pdfUrl && !payload.bytesBase64) {
        const pdf = await fetchPdfAsBase64(payload.pdfUrl);
        payload = {
          ...payload,
          bytesBase64: pdf.base64,
          byteLength: pdf.byteLength,
          pdfUrl: undefined,
        };
      }

      const result = await runWithRetry(tab.id, {
        type: message.action,
        payload,
      });
      sendResponse({ ok: true, tabUrl: tab.url, tabId: tab.id, inject, result });
      return;
    }

    sendResponse({ ok: false, error: 'Unknown message' });
  })().catch((err) => {
    sendResponse({ ok: false, error: err?.message || String(err) });
  });

  return true;
});
