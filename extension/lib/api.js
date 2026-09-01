/** API client — Resume Attach companion. */

export const API_BASE = 'http://127.0.0.1:5002';

function abortMessage(err, timeoutMs, path) {
  const name = err?.name || '';
  const msg = String(err?.message || err || '');
  if (name === 'AbortError' || /aborted|AbortError/i.test(msg)) {
    return `Timed out after ${timeoutMs}ms calling ${path} (is the tracker backend running on :5002?)`;
  }
  if (/Failed to fetch|NetworkError|ECONNREFUSED/i.test(msg)) {
    return `Cannot reach backend at ${API_BASE}${path}`;
  }
  return msg || 'Request failed';
}

async function getJson(path, { timeoutMs = 8000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_BASE}${path}`, { signal: ctrl.signal });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `API ${res.status}: ${path}`);
    }
    return res.json();
  } catch (err) {
    throw new Error(abortMessage(err, timeoutMs, path));
  } finally {
    clearTimeout(t);
  }
}

async function postJson(path, body, { timeoutMs = 10000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `API ${res.status}: ${path}`);
    }
    return res.json();
  } catch (err) {
    throw new Error(abortMessage(err, timeoutMs, path));
  } finally {
    clearTimeout(t);
  }
}

export async function fetchHealth() {
  return getJson('/api/extension/health', { timeoutMs: 3000 });
}

export async function resolvePageUrl(url) {
  return getJson(`/api/extension/resolve?url=${encodeURIComponent(url || '')}`, {
    timeoutMs: 15000,
  });
}

export async function fetchLatestResume() {
  return getJson('/api/extension/latest-resume');
}

export async function markApplied({ jobId, url }) {
  return postJson('/api/extension/mark-applied', { jobId, url });
}

export async function saveJob(payload) {
  return postJson('/api/extension/save-job', payload);
}

export async function fetchProfile() {
  return getJson('/api/extension/profile', { timeoutMs: 5000 });
}

export function resumePdfUrl(jobId) {
  return `${API_BASE}/api/extension/jobs/${jobId}/resume.pdf`;
}

export function coverLetterPdfUrl(jobId) {
  return `${API_BASE}/api/extension/jobs/${jobId}/cover-letter.pdf`;
}

export async function askApplicationQuestion({ question, jobId, url, wordLimit }) {
  return postJson('/api/extension/ask-application', { question, jobId, url, wordLimit }, { timeoutMs: 45000 });
}

export async function generateCoverLetter(jobId) {
  return postJson(`/api/extension/jobs/${jobId}/generate-cover-letter`, {}, { timeoutMs: 90000 });
}

export async function saveApplicationAnswer(question, answer) {
  return postJson('/api/extension/save-application-answer', { question, answer });
}

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Karthik_Kovi_Resume_Aug26.pdf / Karthik_Kovi_Cover_Letter_Aug26.pdf (current month+year). */
export function attachDocumentFilename(kind = 'resume', now = new Date()) {
  const mon = MONTHS[now.getMonth()] || 'Jan';
  const yy = String(now.getFullYear()).slice(-2);
  const label = kind === 'cover_letter' ? 'Cover_Letter' : 'Resume';
  return `Karthik_Kovi_${label}_${mon}${yy}.pdf`;
}
