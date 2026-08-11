import Job from '../models/Job';

export function normalizeJobUrl(url: string): string {
  return url.split(/[?#]/, 1)[0].replace(/\/+$/, '').toLowerCase();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function normalizedJobUrlPattern(url: string): RegExp {
  const cleanUrl = normalizeJobUrl(url);
  return new RegExp(`^${escapeRegex(cleanUrl)}/?(?:[?#].*)?$`, 'i');
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

const TITLE_NOISE =
  /\b(new\s*grad(?:uate)?s?|university\s+grad(?:uate)?s?|entry[\s-]?level|early\s+career|recent\s+grad(?:uate)?s?|associate|junior|i{1,3}\b|iv\b|202[6-8]|full[\s-]?time|remote|hybrid|onsite|on[\s-]?site)\b/gi;

/** Core title tokens for fuzzy same-role matching across sources. */
export function coreTitleForDedup(title: string): string {
  return title
    .toLowerCase()
    .replace(TITLE_NOISE, ' ')
    .replace(/[^a-z0-9+#.\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Same company + similar title (e.g. "SWE, Backend" ≈ "Software Engineer Backend"). */
export function titlesSimilar(a: string, b: string): boolean {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (na === nb) return true;

  const ca = coreTitleForDedup(a);
  const cb = coreTitleForDedup(b);
  if (!ca || !cb) return false;
  if (ca === cb) return true;
  if (ca.includes(cb) || cb.includes(ca)) return true;

  const ta = new Set(ca.split(' ').filter((t) => t.length > 1));
  const tb = new Set(cb.split(' ').filter((t) => t.length > 1));
  if (!ta.size || !tb.size) return false;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter += 1;
  const union = new Set([...ta, ...tb]).size;
  return union > 0 && inter / union >= 0.75;
}

export async function findDuplicateJob(url: string, title: string, company: string) {
  const byNormalizedUrl = await Job.findOne({ url: normalizedJobUrlPattern(url) });
  if (byNormalizedUrl) return byNormalizedUrl;

  const normCompany = normalizeText(company);

  const candidates = await Job.find({
    company: { $regex: new RegExp(`^${escapeRegex(normCompany)}$`, 'i') },
  });

  return (
    candidates.find(
      (job) =>
        normalizeText(job.company) === normCompany && titlesSimilar(job.title, title)
    ) || null
  );
}

export async function isDuplicateJob(url: string, title: string, company: string): Promise<boolean> {
  return Boolean(await findDuplicateJob(url, title, company));
}
