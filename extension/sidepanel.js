import {
  fetchHealth,
  resolvePageUrl,
  fetchLatestResume,
  fetchProfile,
  markApplied,
  saveJob,
  resumePdfUrl,
  attachDocumentFilename,
} from './lib/api.js';

const el = {
  backend: document.getElementById('backendStatus'),
  pageHost: document.getElementById('pageHost'),
  jobMatch: document.getElementById('jobMatch'),
  resumeStatus: document.getElementById('resumeStatus'),
  log: document.getElementById('log'),
  btnRefresh: document.getElementById('btnRefresh'),
  btnResume: document.getElementById('btnResume'),
  btnApplied: document.getElementById('btnApplied'),
  btnAttachApplied: document.getElementById('btnAttachApplied'),
  btnTracker: document.getElementById('btnTracker'),
  btnSave: document.getElementById('btnSave'),
};

let state = {
  resolve: null,
  latestResume: null,
  profile: null,
  tabUrl: '',
  tabId: null,
  backendOk: false,
  lastAttachedJobId: null,
};

let refreshTimer = null;

function log(msg) {
  el.log.textContent = typeof msg === 'string' ? msg : JSON.stringify(msg, null, 2);
}

function setBackend(ok, text) {
  el.backend.textContent = text;
  el.backend.className = `pill ${ok ? 'ok' : 'bad'}`;
  state.backendOk = ok;
}

function resumeSource() {
  if (state.resolve?.resumeReady) return { ...state.resolve, fallback: false };
  if (state.latestResume?.resumeReady) return { ...state.latestResume, fallback: true };
  return null;
}

function markAppliedJobId() {
  return state.resolve?.jobId || state.lastAttachedJobId || null;
}

function updateButtons() {
  const src = resumeSource();
  const canAttach = Boolean(state.backendOk && src?.jobId);
  el.btnResume.disabled = !canAttach;
  if (el.btnAttachApplied) el.btnAttachApplied.disabled = !canAttach;
  el.btnTracker.disabled = !state.resolve?.trackerUrl;
  el.btnApplied.disabled = !(state.backendOk && (markAppliedJobId() || state.resolve?.matched));
  el.btnSave.disabled =
    !state.backendOk || !state.tabUrl || /^(chrome|chrome-extension):/i.test(state.tabUrl);

  if (src?.jobId) {
    el.resumeStatus.textContent = src.fallback
      ? `⚠ Fallback · ${src.company || 'latest PDF'}`
      : `Ready · ${src.company || 'matched'}`;
    el.resumeStatus.className = src.fallback ? 'truncate warn' : 'truncate';
  } else {
    el.resumeStatus.textContent = 'No PDF — approve resume in tracker';
    el.resumeStatus.className = 'truncate';
  }
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function companyFromPage(meta, pageUrl) {
  const host = (() => {
    try {
      return new URL(pageUrl).hostname.replace(/^www\./, '');
    } catch {
      return '';
    }
  })();
  const hostCompany = host.split('.')[0];
  const pretty =
    hostCompany && hostCompany.length > 2
      ? hostCompany.charAt(0).toUpperCase() + hostCompany.slice(1)
      : '';
  const title = String(meta?.title || '');
  const parts = title.split(/\s[-|·–—]\s/).map((s) => s.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const a = parts[0];
    const b = parts[parts.length - 1];
    if (a.length <= 40 && !/engineer|developer|intern|software/i.test(a)) return a;
    if (b.length <= 40) return b;
  }
  return pretty || 'Unknown company';
}

function runOnTab(action, payload, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out talking to the page')), timeoutMs);
    chrome.runtime.sendMessage(
      { type: 'RUN_ON_TAB', action, payload, tabId: state.tabId },
      (res) => {
        clearTimeout(timer);
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (!res?.ok) return reject(new Error(res?.error || 'Tab action failed'));
        resolve(res);
      }
    );
  });
}

function scheduleRefresh(delayMs = 250) {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    void refresh();
  }, delayMs);
}

async function refresh() {
  try {
    log('Checking backend + page…');
    const tab = await getActiveTab();
    state.tabId = tab?.id ?? null;
    state.tabUrl = tab?.url || '';
    try {
      el.pageHost.textContent = state.tabUrl ? new URL(state.tabUrl).host : '—';
    } catch {
      el.pageHost.textContent = state.tabUrl || '—';
    }

    try {
      await fetchHealth();
      setBackend(true, 'Connected');
    } catch (e) {
      setBackend(false, 'Down');
      state.resolve = null;
      state.latestResume = null;
      updateButtons();
      log(`Backend unreachable at 127.0.0.1:5002\n${e.message}`);
      return;
    }

    state.resolve = await resolvePageUrl(state.tabUrl);
    state.latestResume = null;
    try {
      state.profile = await fetchProfile();
    } catch {
      state.profile = null;
    }
    if (!state.resolve?.resumeReady) {
      try {
        state.latestResume = await fetchLatestResume();
      } catch {
        state.latestResume = null;
      }
    }

    el.jobMatch.textContent = state.resolve?.matched
      ? `${state.resolve.company} — ${state.resolve.title}`
      : 'No tracker match';

    updateButtons();

    const src = resumeSource();
    log(
      [
        state.resolve?.matched
          ? `Matched: ${state.resolve.company} / ${state.resolve.status}`
          : 'Page not in tracker — Save page, or Attach uses latest ready PDF',
        src
          ? `PDF: ${src.fallback ? '⚠ FALLBACK (not page match)' : 'matched job'} (${src.company || 'ok'})`
          : 'No resume PDF available',
        '',
        '1) Fill with Simplify',
        '2) Attach resume here',
        '3) You click Submit',
        '4) Mark applied (or Attach + mark)',
      ].join('\n')
    );
  } catch (e) {
    setBackend(false, 'Error');
    updateButtons();
    log(`Refresh crashed: ${e?.message || e}`);
  }
}

async function attachResume({ markAfter = false } = {}) {
  const src = resumeSource();
  if (!src?.jobId) {
    log('No resume PDF. Approve one in the tracker first.');
    return;
  }
  if (src.fallback) {
    const ok = window.confirm(
      `No tracker match for this page.\n\nAttach latest ready PDF for ${src.company || 'unknown'}?\n\nCancel if this is the wrong company.`
    );
    if (!ok) {
      log('Attach cancelled — open the matched job page, or Save page to tracker first.');
      return;
    }
  }
  if (!state.tabId) await refresh();
  const coverLetterText = String(
    state.resolve?.coverLetterDraft || state.profile?.coverLetter || ''
  ).trim();
  log(`Attaching ${src.company || 'resume'} PDF (once)${coverLetterText ? '; cover letter only if field exists' : ''}…`);
  try {
    const res = await runOnTab('RM_ATTACH_RESUME', {
      pdfUrl: resumePdfUrl(src.jobId),
      filename: attachDocumentFilename('resume'),
      coverLetterFilename: attachDocumentFilename('cover_letter'),
      // Cover letter only fills a real cover field — never a second Resume/CV upload
      alsoCoverLetter: Boolean(coverLetterText),
      coverLetterText,
    });
    const r = res.result || {};
    if (r.ok) state.lastAttachedJobId = src.jobId;
    updateButtons();
    if (!r.ok) {
      log(`Could not attach: ${r.error}`);
      return;
    }
    const bits = [
      r.skippedDuplicate
        ? `Resume already on page — skipped duplicate upload (${r.filename})`
        : `Attached once: ${r.filename || r.target}`,
    ];
    if (src.fallback) bits[0] += ' (fallback)';
    if (r.coverAttached) {
      bits.push(
        r.coverMode === 'text'
          ? 'Cover letter: pasted into text field'
          : `Cover letter file: ${r.coverFilename || 'attached'}`
      );
    } else if (coverLetterText) {
      bits.push('Cover letter: no separate field on this page (resume only)');
    }
    bits.push(r.note || 'Verify on page, then Submit.');
    log(bits.join('\n'));
    if (markAfter) {
      await markJobApplied();
    }
  } catch (e) {
    log(
      `Attach failed: ${e.message}\n` +
        (String(e.message || '').includes('Could not load file')
          ? 'Stale extension build. chrome://extensions → Reload Resume Attach → refresh this tab → retry.'
          : 'Reload extension, refresh this tab, retry.')
    );
  }
}

async function markJobApplied() {
  const jobId = markAppliedJobId();
  log('Marking applied…');
  try {
    const res = await markApplied({ jobId, url: state.tabUrl });
    log(`Marked applied: ${res.company} — ${res.title}`);
    if (state.resolve) state.resolve.status = 'applied';
    updateButtons();
  } catch (e) {
    log(`Mark applied failed: ${e.message}\nSave page to tracker first if needed.`);
  }
}

async function saveToTracker() {
  log('Saving page to tracker…');
  try {
    const meta = await runOnTab('RM_PAGE_META', {}).catch(() => ({ result: {} }));
    const m = meta.result || {};
    const saved = await saveJob({
      url: state.tabUrl,
      title: m.h1 || m.title || 'Untitled role',
      company: companyFromPage(m, state.tabUrl),
      description: `Saved from Resume Attach\n${m.title || ''}\n${state.tabUrl}`,
    });
    if (saved.jobId) {
      state.resolve = {
        ...(state.resolve || {}),
        matched: true,
        jobId: saved.jobId,
        title: saved.title,
        company: saved.company,
        status: saved.status,
        trackerUrl: saved.trackerUrl,
      };
      el.jobMatch.textContent = `${saved.company} — ${saved.title}`;
      updateButtons();
    }
    log(
      saved.created
        ? `Saved: ${saved.company} — ${saved.title}`
        : `Already in tracker: ${saved.company} — ${saved.title}`
    );
  } catch (e) {
    log(`Save failed: ${e.message}`);
  }
}

function openTracker() {
  if (state.resolve?.trackerUrl) chrome.tabs.create({ url: state.resolve.trackerUrl });
}

el.btnRefresh.addEventListener('click', () => refresh());
el.btnResume.addEventListener('click', () => attachResume());
el.btnApplied.addEventListener('click', () => markJobApplied());
if (el.btnAttachApplied) {
  el.btnAttachApplied.addEventListener('click', () => attachResume({ markAfter: true }));
}
el.btnTracker.addEventListener('click', () => openTracker());
el.btnSave.addEventListener('click', () => saveToTracker());

chrome.tabs.onActivated.addListener(() => scheduleRefresh());
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (tabId === state.tabId && (info.url || info.status === 'complete')) scheduleRefresh(400);
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') scheduleRefresh(100);
});

refresh();
