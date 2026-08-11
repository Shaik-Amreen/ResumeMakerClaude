/** API client — Resume Attach companion. */

export const API_BASE = 'http://127.0.0.1:5002';

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
  } finally {
    clearTimeout(t);
  }
}

export async function fetchHealth() {
  return getJson('/api/extension/health', { timeoutMs: 3000 });
}

export async function resolvePageUrl(url) {
  return getJson(`/api/extension/resolve?url=${encodeURIComponent(url || '')}`);
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

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Karthik_Kovi_Resume_Aug26.pdf / Karthik_Kovi_Cover_Letter_Aug26.pdf (current month+year). */
export function attachDocumentFilename(kind = 'resume', now = new Date()) {
  const mon = MONTHS[now.getMonth()] || 'Jan';
  const yy = String(now.getFullYear()).slice(-2);
  const label = kind === 'cover_letter' ? 'Cover_Letter' : 'Resume';
  return `Karthik_Kovi_${label}_${mon}${yy}.pdf`;
}
