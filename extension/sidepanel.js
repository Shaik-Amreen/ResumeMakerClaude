import {
  fetchHealth,
  resolvePageUrl,
  fetchLatestResume,
  fetchProfile,
  markApplied,
  saveJob,
  resumePdfUrl,
  coverLetterPdfUrl,
  attachDocumentFilename,
  askApplicationQuestion,
  saveApplicationAnswer,
  generateCoverLetter,
} from './lib/api.js';

const el = {
  backend: document.getElementById('backendStatus'),
  pageHost: document.getElementById('pageHost'),
  jobMatch: document.getElementById('jobMatch'),
  resumeStatus: document.getElementById('resumeStatus'),
  coverStatus: document.getElementById('coverStatus'),
  log: document.getElementById('log'),
  btnRefresh: document.getElementById('btnRefresh'),
  btnResume: document.getElementById('btnResume'),
  btnApplied: document.getElementById('btnApplied'),
  btnAttachApplied: document.getElementById('btnAttachApplied'),
  btnDlResume: document.getElementById('btnDlResume'),
  btnGenerateCover: document.getElementById('btnGenerateCover'),
  btnDlCover: document.getElementById('btnDlCover'),
  btnTracker: document.getElementById('btnTracker'),
  btnSave: document.getElementById('btnSave'),
  btnScanQuestions: document.getElementById('btnScanQuestions'),
  qaPick: document.getElementById('qaPick'),
  qaQuestion: document.getElementById('qaQuestion'),
  qaAnswer: document.getElementById('qaAnswer'),
  btnAskAi: document.getElementById('btnAskAi'),
  btnCopyAnswer: document.getElementById('btnCopyAnswer'),
  btnFillAnswer: document.getElementById('btnFillAnswer'),
  btnSaveAnswer: document.getElementById('btnSaveAnswer'),
};

let state = {
  resolve: null,
  latestResume: null,
  profile: null,
  tabUrl: '',
  tabId: null,
  backendOk: false,
  lastAttachedJobId: null,
  qaQuestions: [],
  qaSelectedKey: '',
  qaGenerating: false,
  coverGenerating: false,
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
  // Never attach another company's PDF when this page matched a tracker job (even if PDF missing).
  if (state.resolve?.matched) return null;
  if (state.latestResume?.resumeReady) return { ...state.latestResume, fallback: true };
  return null;
}

function markAppliedJobId() {
  return state.resolve?.jobId || state.lastAttachedJobId || null;
}

function coverLetterSource() {
  const profile = String(state.profile?.coverLetter || '').trim();
  // Cover letter always follows the matched tracker job — never a fallback resume's company.
  if (state.resolve?.matched && state.resolve?.jobId) {
    const draft = String(state.resolve.coverLetterDraft || '').trim();
    if (draft) {
      return {
        jobId: state.resolve.jobId,
        text: draft,
        fromDraft: true,
        company: state.resolve.company || '',
      };
    }
    if (profile) {
      return {
        jobId: state.resolve.jobId,
        text: profile,
        fromDraft: false,
        generic: true,
        company: state.resolve.company || '',
      };
    }
    return null;
  }
  // Unmatched page: generic profile text only — do not pull another job's cover PDF.
  if (profile) {
    return { jobId: null, text: profile, fromDraft: false, generic: true, company: '' };
  }
  return null;
}

function updateQaButtons() {
  const hasQuestion = Boolean(el.qaQuestion?.value?.trim());
  const hasAnswer = Boolean(el.qaAnswer?.value?.trim());
  const canQa = Boolean(state.backendOk && state.tabId);
  if (el.btnScanQuestions) el.btnScanQuestions.disabled = !canQa;
  if (el.qaPick) el.qaPick.disabled = !canQa || !state.qaQuestions.length;
  if (el.btnAskAi) el.btnAskAi.disabled = !canQa || !hasQuestion || state.qaGenerating;
  if (el.btnCopyAnswer) el.btnCopyAnswer.disabled = !hasAnswer;
  if (el.btnFillAnswer) el.btnFillAnswer.disabled = !canQa || !hasAnswer;
  if (el.btnSaveAnswer) el.btnSaveAnswer.disabled = !canQa || !hasQuestion || !hasAnswer;
}

function updateButtons() {
  const src = resumeSource();
  const cover = coverLetterSource();
  const canAttach = Boolean(state.backendOk && src?.jobId);
  el.btnResume.disabled = !canAttach;
  if (el.btnAttachApplied) el.btnAttachApplied.disabled = !canAttach;
  if (el.btnDlResume) el.btnDlResume.disabled = !canAttach;
  const coverJobId = applicationJobId();
  if (el.btnGenerateCover) {
    el.btnGenerateCover.disabled = !(state.backendOk && coverJobId && state.resolve?.matched) || state.coverGenerating;
  }
  if (el.btnDlCover) el.btnDlCover.disabled = !(state.backendOk && cover?.jobId);
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

  if (el.coverStatus) {
    if (state.coverGenerating) {
      el.coverStatus.textContent = 'Generating cover letter…';
      el.coverStatus.className = 'truncate';
    } else if (cover?.fromDraft) {
      el.coverStatus.textContent = `Ready · ${cover.company || 'draft'}`;
      el.coverStatus.className = 'truncate';
    } else if (cover?.generic) {
      el.coverStatus.textContent = state.resolve?.matched
        ? `Generic template · Generate cover letter for ${cover.company || 'this job'}`
        : 'Generic template (page not matched — match job first)';
      el.coverStatus.className = 'truncate warn';
    } else {
      el.coverStatus.textContent = state.resolve?.matched
        ? 'No cover — Generate cover letter'
        : 'No cover letter — match or save job first';
      el.coverStatus.className = 'truncate';
    }
  }
  updateQaButtons();
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

    try {
      state.resolve = await resolvePageUrl(state.tabUrl);
    } catch (e) {
      state.resolve = null;
      updateButtons();
      log(`Could not match this page:\n${e.message}\n\nBackend is up — try Refresh again, or Save page to tracker.`);
      return;
    }

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
    updateButtons();
    log(`Refresh crashed: ${e?.message || e}`);
  }
}

async function attachResume({ markAfter = false } = {}) {
  const src = resumeSource();
  if (!src?.jobId) {
    if (state.resolve?.matched && !state.resolve?.resumeReady) {
      log(`Matched ${state.resolve.company} but no resume PDF yet — approve/generate in tracker first.`);
    } else {
      log('No resume PDF. Approve one in the tracker first.');
    }
    return;
  }
  if (src.fallback) {
    const ok = window.confirm(
      `No tracker match for this page.\n\nAttach latest ready PDF for ${src.company || 'unknown'}?\n\nThis is NOT tailored to the company on this page. Cancel and use Save page to tracker first.`
    );
    if (!ok) {
      log('Attach cancelled — open the matched job page, or Save page to tracker first.');
      return;
    }
  }
  if (!state.tabId) await refresh();
  // Re-resolve so attach uses the latest coverLetterDraft / pdfPath from tracker.
  if (state.resolve?.matched && state.tabUrl) {
    try {
      const fresh = await resolvePageUrl(state.tabUrl);
      if (fresh?.matched) state.resolve = fresh;
    } catch {
      /* keep cached resolve */
    }
  }
  const cover = coverLetterSource();
  const coverLetterText = cover?.text || '';
  const coverPdfUrl =
    cover?.jobId && cover.fromDraft ? coverLetterPdfUrl(cover.jobId) : null;
  log(
    `Attaching ${src.company || 'resume'} PDF (once)${coverLetterText ? cover?.fromDraft ? '; tailored cover letter' : '; generic cover template' : ''}…`
  );
  try {
    const res = await runOnTab('RM_ATTACH_RESUME', {
      pdfUrl: resumePdfUrl(src.jobId),
      filename: attachDocumentFilename('resume'),
      coverLetterFilename: attachDocumentFilename('cover_letter'),
      alsoCoverLetter: Boolean(coverLetterText),
      coverLetterText,
      coverLetterPdfUrl: coverPdfUrl,
      preferCoverPdf: Boolean(coverPdfUrl),
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

async function downloadPdf(url, filename) {
  const res = await fetch(url);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `Download failed (${res.status})`);
  }
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
  }
}

async function downloadResumePdf() {
  const src = resumeSource();
  if (!src?.jobId) {
    log('No resume PDF available. Approve a resume in the tracker first.');
    return;
  }
  const name = attachDocumentFilename('resume');
  log(`Downloading resume: ${name}…`);
  try {
    await downloadPdf(resumePdfUrl(src.jobId), name);
    log(`Downloaded resume: ${name}${src.fallback ? ' (fallback / latest ready)' : ''}`);
  } catch (e) {
    log(`Resume download failed: ${e.message}`);
  }
}

async function downloadCoverLetterPdf() {
  const cover = coverLetterSource();
  if (!cover?.jobId) {
    log('No cover letter yet. Click Generate cover letter first.');
    return;
  }
  const name = attachDocumentFilename('cover_letter');
  log(`Downloading cover letter: ${name}…`);
  try {
    await downloadPdf(coverLetterPdfUrl(cover.jobId), name);
    log(
      `Downloaded cover letter: ${name}\n` +
        (cover.fromDraft
          ? 'Use Additional Attachments / Cover Letter upload on the form if Attach skipped it.'
          : 'Using profile default — generate a tailored letter in the tracker when you can.')
    );
  } catch (e) {
    log(`Cover letter download failed: ${e.message}`);
  }
}

async function generateCoverLetterForJob() {
  const jobId = applicationJobId();
  if (!jobId || !state.resolve?.matched) {
    log('Match this page to a tracker job first (Refresh, or Save page to tracker).');
    return;
  }
  state.coverGenerating = true;
  updateButtons();
  log(`Generating tailored cover letter for ${state.resolve.company || 'this job'}…`);
  try {
    const res = await generateCoverLetter(jobId);
    state.resolve = {
      ...state.resolve,
      coverLetterDraft: res.coverLetterDraft || state.resolve.coverLetterDraft,
    };
    updateButtons();
    const preview = String(res.coverLetterDraft || '').slice(0, 120);
    log(
      [
        `Cover letter ready · ${res.company || state.resolve.company}`,
        preview ? `${preview}${res.coverLetterDraft.length > 120 ? '…' : ''}` : '',
        '',
        'Use Attach resume (includes cover when field exists), Download cover letter, or open tracker to edit.',
      ]
        .filter(Boolean)
        .join('\n')
    );
  } catch (e) {
    log(`Generate cover letter failed: ${e.message}`);
  } finally {
    state.coverGenerating = false;
    updateButtons();
  }
}

function openTracker() {
  if (state.resolve?.trackerUrl) chrome.tabs.create({ url: state.resolve.trackerUrl });
}

function applicationJobId() {
  return state.resolve?.jobId || null;
}

function renderQaPick() {
  if (!el.qaPick) return;
  const prev = el.qaPick.value;
  el.qaPick.innerHTML = '<option value="">Pick from page…</option>';
  for (const q of state.qaQuestions) {
    const opt = document.createElement('option');
    opt.value = q.key;
    const prefix = q.empty ? '' : '✓ ';
    opt.textContent = `${prefix}${q.label.slice(0, 72)}${q.label.length > 72 ? '…' : ''}`;
    el.qaPick.appendChild(opt);
  }
  if (prev && state.qaQuestions.some((q) => q.key === prev)) el.qaPick.value = prev;
}

async function scanQuestionsFromPage() {
  if (!state.tabId) await refresh();
  log('Scanning page for custom questions…');
  try {
    const res = await runOnTab('RM_SCAN_APPLICATION_QUESTIONS', {});
    const questions = res.result?.questions || [];
    state.qaQuestions = questions;
    renderQaPick();
    updateQaButtons();
    if (!questions.length) {
      log('No custom text questions found.\nPaste the prompt manually, or scroll the form and scan again.');
      return;
    }
    log(`Found ${questions.length} custom question(s). Pick one or paste your own, then Generate answer.`);
    const firstEmpty = questions.find((q) => q.empty) || questions[0];
    if (firstEmpty && !el.qaQuestion.value.trim()) {
      el.qaQuestion.value = firstEmpty.label;
      state.qaSelectedKey = firstEmpty.key;
      el.qaPick.value = firstEmpty.key;
    }
  } catch (e) {
    log(`Scan failed: ${e.message}`);
  }
}

async function generateQaAnswer() {
  const question = el.qaQuestion.value.trim();
  if (!question) {
    log('Enter or pick a question first.');
    return;
  }
  state.qaGenerating = true;
  updateQaButtons();
  log(`Generating answer${state.resolve?.company ? ` for ${state.resolve.company}` : ''}…`);
  try {
    const res = await askApplicationQuestion({
      question,
      jobId: applicationJobId(),
      url: state.tabUrl,
    });
    el.qaAnswer.value = res.answer || '';
    const src =
      res.source === 'bank'
        ? `from answer bank (${Math.round((res.bankScore || 1) * 100)}% match)`
        : `AI${res.company ? ` · ${res.company}` : ''}`;
    log(`Answer ready (${src}). Review, edit, then Fill field or Copy.`);
  } catch (e) {
    log(`Generate failed: ${e.message}`);
  } finally {
    state.qaGenerating = false;
    updateQaButtons();
  }
}

async function copyQaAnswer() {
  const text = el.qaAnswer.value.trim();
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    log('Answer copied to clipboard.');
  } catch {
    log('Copy failed — select the answer text manually.');
  }
}

async function fillQaAnswer() {
  const answer = el.qaAnswer.value.trim();
  if (!answer) return;
  const key = state.qaSelectedKey || el.qaPick?.value || '';
  const question = el.qaQuestion.value.trim();
  log('Filling answer into the form field…');
  try {
    const res = await runOnTab('RM_FILL_APPLICATION_ANSWER', {
      answer,
      key: key || undefined,
      label: question || undefined,
    });
    const r = res.result || {};
    if (!r.ok) {
      log(`Could not fill: ${r.error || 'unknown error'}\nTry Copy and paste manually.`);
      return;
    }
    log(`Filled: ${r.target || 'field'}\nVerify on the page before Submit.`);
  } catch (e) {
    log(`Fill failed: ${e.message}`);
  }
}

async function saveQaToBank() {
  const question = el.qaQuestion.value.trim();
  const answer = el.qaAnswer.value.trim();
  if (!question || !answer) return;
  try {
    await saveApplicationAnswer(question, answer);
    log('Saved to answer bank — reuse from tracker Answer bank or on similar questions.');
  } catch (e) {
    log(`Save failed: ${e.message}`);
  }
}

el.btnRefresh.addEventListener('click', () => refresh());
el.btnResume.addEventListener('click', () => attachResume());
el.btnApplied.addEventListener('click', () => markJobApplied());
if (el.btnAttachApplied) {
  el.btnAttachApplied.addEventListener('click', () => attachResume({ markAfter: true }));
}
if (el.btnDlResume) el.btnDlResume.addEventListener('click', () => downloadResumePdf());
if (el.btnGenerateCover) el.btnGenerateCover.addEventListener('click', () => generateCoverLetterForJob());
if (el.btnDlCover) el.btnDlCover.addEventListener('click', () => downloadCoverLetterPdf());
el.btnTracker.addEventListener('click', () => openTracker());
el.btnSave.addEventListener('click', () => saveToTracker());
if (el.btnScanQuestions) el.btnScanQuestions.addEventListener('click', () => scanQuestionsFromPage());
if (el.btnAskAi) el.btnAskAi.addEventListener('click', () => generateQaAnswer());
if (el.btnCopyAnswer) el.btnCopyAnswer.addEventListener('click', () => copyQaAnswer());
if (el.btnFillAnswer) el.btnFillAnswer.addEventListener('click', () => fillQaAnswer());
if (el.btnSaveAnswer) el.btnSaveAnswer.addEventListener('click', () => saveQaToBank());
if (el.qaPick) {
  el.qaPick.addEventListener('change', () => {
    const key = el.qaPick.value;
    state.qaSelectedKey = key;
    const row = state.qaQuestions.find((q) => q.key === key);
    if (row) el.qaQuestion.value = row.label;
    updateQaButtons();
  });
}
for (const input of [el.qaQuestion, el.qaAnswer]) {
  input?.addEventListener('input', () => updateQaButtons());
}

chrome.tabs.onActivated.addListener(() => scheduleRefresh());
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (tabId === state.tabId && (info.url || info.status === 'complete')) scheduleRefresh(400);
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') scheduleRefresh(100);
});

refresh();
