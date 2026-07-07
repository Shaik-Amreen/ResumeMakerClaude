/** Turn platform text like "2 days ago" or "Jan 12, 2026" into an absolute Date. */
export function parsePostedTextToDate(text?: string, referenceDate = new Date()): Date | undefined {
  if (!text?.trim()) return undefined;

  const t = text.trim().toLowerCase();

  if (t.includes('just now') || t === 'today') return new Date(referenceDate);
  if (t.includes('yesterday')) {
    const d = new Date(referenceDate);
    d.setDate(d.getDate() - 1);
    return d;
  }

  const rel = t.match(/(\d+)\s*(minute|hour|day|week|month|year)s?\s*ago/);
  if (rel) {
    const n = Number(rel[1]);
    const unit = rel[2];
    const d = new Date(referenceDate);
    if (unit.startsWith('minute')) d.setMinutes(d.getMinutes() - n);
    else if (unit.startsWith('hour')) d.setHours(d.getHours() - n);
    else if (unit.startsWith('day')) d.setDate(d.getDate() - n);
    else if (unit.startsWith('week')) d.setDate(d.getDate() - n * 7);
    else if (unit.startsWith('month')) d.setMonth(d.getMonth() - n);
    else if (unit.startsWith('year')) d.setFullYear(d.getFullYear() - n);
    return d;
  }

  const plusDays = t.match(/(\d+)\+\s*days?\s*ago/);
  if (plusDays) {
    const d = new Date(referenceDate);
    d.setDate(d.getDate() - Number(plusDays[1]));
    return d;
  }

  const cleaned = text.replace(/^(posted|reposted)\s+/i, '').trim();
  const parsed = Date.parse(cleaned);
  if (!Number.isNaN(parsed)) return new Date(parsed);

  return undefined;
}

export function resolvePostedAt(
  posted?: string,
  postedAt?: Date | string | null,
  referenceDate = new Date()
): Date | undefined {
  if (postedAt) {
    const d = postedAt instanceof Date ? postedAt : new Date(postedAt);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return parsePostedTextToDate(posted, referenceDate);
}
