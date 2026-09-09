/**
 * Company verification — filter staffing mills / profile-marketing consultancies.
 *
 * Signals (best-effort, free, no API keys):
 *  1. Known staffing / body-shop name list
 *  2. JD / company-name red-flag language ("market your profile", C2C, bench…)
 *  3. Clearbit autocomplete — real employers usually have a resolvable domain
 *  4. Wikipedia — notable product companies have encyclopedia pages
 *  5. Existing H1B seed rating (h1bCompanyRatings.ts)
 *
 * Glassdoor/Levels require paid APIs — we surface review *search links* instead.
 */

import { normalizeCompanyName, resolveCompanyRating } from '../data/h1bCompanyRatings';
import { config } from '../config';

export type CompanyVerifyStatus =
  | 'verified'
  | 'likely_real'
  | 'unknown'
  | 'suspicious'
  | 'staffing'
  | 'spam';

export type CompanyVerifyResult = {
  status: CompanyVerifyStatus;
  skip: boolean;
  reason: string;
  domain?: string;
  wikiTitle?: string;
  rating: number;
  ratingReason: string;
  sources: string[];
  reviewLinks: { label: string; url: string }[];
};

/** High-volume staffing / IT body shops — skip by default (not Big4 / product consulting). */
const KNOWN_STAFFING = new Set(
  [
    'apex systems',
    'teksystems',
    'tek systems',
    'insight global',
    'robert half',
    'robert half technology',
    'kforce',
    'randstad',
    'randstad technologies',
    'adecco',
    'manpower',
    'manpowergroup',
    'volt',
    'volt workforce',
    'collabera',
    'compunnel',
    'compunnel software',
    'softnice',
    'judge group',
    'the judge group',
    'modis',
    'akima',
    'experis',
    'hays',
    'michael page',
    'pagegroup',
    'beacon hill',
    'beacon hill staffing',
    'motion recruitment',
    'cybercoders',
    'dice recruiter',
    'actalent',
    'allegis',
    'allegis group',
    'aerotek',
    'tekwissen',
    'infobahn softworld',
    'vsoft consulting',
    'v-soft consulting',
    'ask it consulting',
    'askit consulting',
    'smartworks',
    'smartworks llc',
    'pyramid consulting',
    'tatvasoft',
    'softpath',
    'softpath system',
    'e-solutions',
    'esolutions',
  ].map((s) => s.toLowerCase())
);

/** Product / Big4 names that should never be skipped as "staffing" even if JD says consulting. */
const TRUSTED_PRODUCT_OR_BIG4 = new Set(
  [
    'google',
    'meta',
    'apple',
    'microsoft',
    'amazon',
    'nvidia',
    'netflix',
    'stripe',
    'databricks',
    'openai',
    'anthropic',
    'adobe',
    'salesforce',
    'uber',
    'linkedin',
    'snowflake',
    'airbnb',
    'coinbase',
    'palantir',
    'bloomberg',
    'doordash',
    'accenture',
    'deloitte',
    'ey',
    'pwc',
    'kpmg',
    'ibm',
    'oracle',
    'cisco',
    'intel',
    'jpmorgan',
    'goldman',
  ].map((s) => s.toLowerCase())
);

const PROFILE_MARKETING_RE = [
  /\bmarket(?:ing)?\s+(?:your|candidate|our)\s+profiles?\b/i,
  /\bsubmit(?:ting)?\s+(?:your\s+)?profiles?\s+to\s+(?:our\s+)?clients?\b/i,
  /\bbench\s+(?:sales|resources?|candidates?)\b/i,
  /\bon\s+the\s+bench\b/i,
  /\bcorp[\s-]?to[\s-]?corp\b/i,
  /\bc2c\b/i,
  /\bwe\s+are\s+a\s+(?:staffing|recruiting|consultancy|consulting)\s+(?:firm|company|agency)\b/i,
  /\bstaffing\s+(?:agency|firm|company)\b/i,
  /\bthird[\s-]?party\s+(?:recruiter|vendor|staffing)\b/i,
  /\bimpl(?:ementation)?\s+partner\s+(?:looking|hiring)\b/i,
  /\bvendor\s+management\s+system\b/i,
  /\bhotlist\b/i,
  /\bimmediate\s+joiners?\s+(?:only|preferred)\b/i,
  /\bclient\s+interview\s+(?:asap|only)\b/i,
];

const NAME_STAFFING_RE = [
  /\bstaffing\b/i,
  /\brecruiting\b/i,
  /\brecruiters?\b/i,
  /\btalent\s+solutions?\b/i,
  /\bworkforce\s+solutions?\b/i,
  /\bpeople\s+solutions?\b/i,
  /\bconsulting\s+services?\b/i,
  /\bit\s+consulting\b/i,
  /\btech(?:nology)?\s+consulting\b/i,
];

function reviewLinksFor(company: string, domain?: string): { label: string; url: string }[] {
  const q = encodeURIComponent(company.trim());
  const d = domain ? encodeURIComponent(domain.replace(/^www\./, '')) : '';
  return [
    {
      label: 'Glassdoor',
      url: `https://www.glassdoor.com/Search/results.htm?keyword=${q}`,
    },
    {
      label: 'Levels.fyi',
      url: `https://www.levels.fyi/companies/?search=${q}`,
    },
    {
      label: 'Blind',
      url: `https://www.teamblind.com/company/search?query=${q}`,
    },
    {
      label: 'H1B / LCA',
      url: `https://h1bdata.info/index.php?em=${q}`,
    },
    ...(d
      ? [
          {
            label: 'Website',
            url: `https://${domain!.replace(/^https?:\/\//, '')}`,
          },
        ]
      : []),
  ];
}

function nameLooksStaffing(company: string): string | null {
  const norm = normalizeCompanyName(company);
  if (KNOWN_STAFFING.has(norm)) return `Known staffing / body-shop: ${company}`;
  for (const key of KNOWN_STAFFING) {
    if (key.length >= 5 && (norm.includes(key) || key.includes(norm))) {
      return `Known staffing / body-shop: ${company}`;
    }
  }
  for (const re of NAME_STAFFING_RE) {
    if (re.test(company)) return `Company name looks like staffing: matched ${re.source}`;
  }
  return null;
}

function jdLooksProfileMarketing(jd: string): string | null {
  for (const re of PROFILE_MARKETING_RE) {
    if (re.test(jd)) return `JD looks like profile-marketing / bench sales (${re.source})`;
  }
  return null;
}

function isTrusted(company: string): boolean {
  const norm = normalizeCompanyName(company);
  if (TRUSTED_PRODUCT_OR_BIG4.has(norm)) return true;
  for (const key of TRUSTED_PRODUCT_OR_BIG4) {
    if (key.length >= 4 && (norm === key || norm.startsWith(key + ' ') || norm.includes(' ' + key))) {
      return true;
    }
  }
  return false;
}

async function clearbitSuggest(
  company: string
): Promise<{ name: string; domain: string } | null> {
  try {
    const url = `https://autocomplete.clearbit.com/v1/companies/suggest?query=${encodeURIComponent(
      company.trim().slice(0, 80)
    )}`;
    const res = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'ResumeMakerClaude/1.0' },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const rows = (await res.json()) as Array<{ name?: string; domain?: string }>;
    if (!Array.isArray(rows) || !rows.length) return null;

    const norm = normalizeCompanyName(company);
    const exact =
      rows.find((r) => normalizeCompanyName(r.name || '') === norm) ||
      rows.find((r) => {
        const n = normalizeCompanyName(r.name || '');
        return n && (norm.includes(n) || n.includes(norm));
      }) ||
      rows[0];
    if (!exact?.domain) return null;
    return { name: exact.name || company, domain: exact.domain };
  } catch {
    return null;
  }
}

async function wikipediaHit(
  company: string
): Promise<{ title: string; description?: string } | null> {
  try {
    const searchUrl =
      `https://en.wikipedia.org/w/api.php?action=opensearch&limit=5&namespace=0&format=json` +
      `&search=${encodeURIComponent(company.trim().slice(0, 80))}`;
    const res = await fetch(searchUrl, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'ResumeMakerClaude/1.0 (local job tracker; company verify)',
      },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as [string, string[], string[], string[]];
    const titles = data[1] || [];
    const norms = normalizeCompanyName(company);
    const title =
      titles.find((t) => normalizeCompanyName(t) === norms) ||
      titles.find((t) => {
        const n = normalizeCompanyName(t);
        return n.startsWith(norms) || norms.startsWith(n);
      });
    if (!title) return null;

    const sumRes = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
      {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'ResumeMakerClaude/1.0 (local job tracker; company verify)',
        },
        signal: AbortSignal.timeout(6000),
      }
    );
    if (!sumRes.ok) return { title };
    const sum = (await sumRes.json()) as { title?: string; description?: string; type?: string };
    if (sum.type === 'disambiguation') return null;
    return { title: sum.title || title, description: sum.description };
  } catch {
    return null;
  }
}

function staffingDomain(domain?: string): boolean {
  if (!domain) return false;
  return /\b(staffing|recruit|talent|workforce|people[-]?solutions)\b/i.test(domain);
}

/** Per-scrape cache: same company appears on many boards — verify once. */
const verifyCache = new Map<string, CompanyVerifyResult>();

export function clearCompanyVerifyCache(): void {
  verifyCache.clear();
}

function cacheKey(company: string): string {
  return normalizeCompanyName(company) || company.trim().toLowerCase();
}

/**
 * Apply JD-only red flags onto a name-level verify result (or fresh skip).
 */
function applyJdMarketingGate(
  base: CompanyVerifyResult,
  company: string,
  jd: string
): CompanyVerifyResult {
  if (!jd) return base;
  const trusted = isTrusted(company);
  const marketingJd = jdLooksProfileMarketing(jd);
  if (!marketingJd || trusted) return base;
  const skipStaffing = config.skipRules.skipStaffingConsultancies !== false;
  return {
    status: 'spam',
    skip: skipStaffing,
    reason: marketingJd,
    domain: base.domain,
    wikiTitle: base.wikiTitle,
    rating: 1,
    ratingReason: marketingJd,
    sources: [...base.sources, 'jd-red-flag'],
    reviewLinks: base.reviewLinks.length ? base.reviewLinks : reviewLinksFor(company, base.domain),
  };
}

/**
 * Verify whether a company looks like a real employer vs staffing / profile-marketing mill.
 * Name + Clearbit/Wikipedia run first; JD marketing flags applied when JD is present.
 */
export async function verifyCompany(
  company: string,
  jobDescription?: string
): Promise<CompanyVerifyResult> {
  const name = String(company || '').trim() || 'Unknown';
  const jd = String(jobDescription || '');
  const key = cacheKey(name);
  const cached = verifyCache.get(key);
  if (cached) {
    return applyJdMarketingGate(cached, name, jd);
  }

  const sources: string[] = [];
  const seed = resolveCompanyRating(name, jd);
  let rating = seed.rating;
  let ratingReason = seed.reason;
  const skipStaffing = config.skipRules.skipStaffingConsultancies !== false;

  const trusted = isTrusted(name);
  const staffingName = nameLooksStaffing(name);

  if (staffingName && !trusted) {
    sources.push('staffing-list');
    const result: CompanyVerifyResult = {
      status: 'staffing',
      skip: skipStaffing,
      reason: staffingName,
      rating: 1,
      ratingReason: staffingName,
      sources,
      reviewLinks: reviewLinksFor(name),
    };
    verifyCache.set(key, result);
    return applyJdMarketingGate(result, name, jd);
  }

  // Fast path: JD marketing before network when we already have text
  const earlyMarketing = jdLooksProfileMarketing(jd);
  if (earlyMarketing && !trusted) {
    sources.push('jd-red-flag');
    return {
      status: 'spam',
      skip: skipStaffing,
      reason: earlyMarketing,
      rating: 1,
      ratingReason: earlyMarketing,
      sources,
      reviewLinks: reviewLinksFor(name),
    };
  }

  const [clearbit, wiki] = await Promise.all([clearbitSuggest(name), wikipediaHit(name)]);
  if (clearbit) sources.push('clearbit');
  if (wiki) sources.push('wikipedia');
  sources.push(`h1b-seed:${seed.source}`);

  let result: CompanyVerifyResult;

  if (clearbit?.domain && staffingDomain(clearbit.domain) && !trusted) {
    result = {
      status: 'staffing',
      skip: skipStaffing,
      reason: `Clearbit domain looks like staffing (${clearbit.domain})`,
      domain: clearbit.domain,
      rating: 1,
      ratingReason: `Staffing-like domain ${clearbit.domain}`,
      sources,
      reviewLinks: reviewLinksFor(name, clearbit.domain),
    };
  } else if (!trusted && !clearbit && !wiki && seed.source === 'default') {
    // Unknown tiny LLC with no Clearbit + no Wikipedia → suspicious
    rating = 1 as typeof rating;
    ratingReason = 'No Clearbit/Wikipedia match — likely unverified / micro consultancy';
    result = {
      status: 'suspicious',
      skip: skipStaffing && config.skipRules.skipUnverifiedCompanies === true,
      reason: ratingReason,
      rating,
      ratingReason,
      sources,
      reviewLinks: reviewLinksFor(name),
    };
  } else if (wiki && (seed.source === 'seed' || trusted || clearbit)) {
    if (rating < 5 && seed.source === 'seed') {
      /* keep seed rating */
    } else if (rating < 3 && wiki) {
      rating = Math.max(rating, 3) as typeof rating;
      ratingReason = `${ratingReason} · Wikipedia: ${wiki.title}`;
    }
    result = {
      status: trusted || seed.source === 'seed' ? 'verified' : 'likely_real',
      skip: false,
      reason: wiki.description
        ? `Wikipedia: ${wiki.title} — ${wiki.description}`
        : `Wikipedia: ${wiki.title}`,
      domain: clearbit?.domain,
      wikiTitle: wiki.title,
      rating,
      ratingReason,
      sources,
      reviewLinks: reviewLinksFor(name, clearbit?.domain),
    };
  } else if (clearbit?.domain) {
    if (seed.source === 'default' && rating < 3) {
      rating = 2 as typeof rating;
      ratingReason = `Clearbit domain ${clearbit.domain} (unranked employer)`;
    }
    result = {
      status: seed.source === 'seed' || trusted ? 'verified' : 'likely_real',
      skip: false,
      reason: `Clearbit match: ${clearbit.name} (${clearbit.domain})`,
      domain: clearbit.domain,
      rating,
      ratingReason,
      sources,
      reviewLinks: reviewLinksFor(name, clearbit.domain),
    };
  } else if (seed.source === 'consulting') {
    result = {
      status: 'likely_real',
      skip: false,
      reason: `Known IT consulting sponsor (${seed.reason}) — not skipped, but prefer product roles`,
      rating,
      ratingReason,
      sources,
      reviewLinks: reviewLinksFor(name),
    };
  } else {
    result = {
      status: seed.source === 'seed' || trusted ? 'verified' : 'unknown',
      skip: false,
      reason: seed.reason,
      rating,
      ratingReason,
      sources,
      reviewLinks: reviewLinksFor(name),
    };
  }

  // Cache name-level result (without JD spam) so later listings reuse Clearbit/Wiki.
  verifyCache.set(key, result);
  return applyJdMarketingGate(result, name, jd);
}

/**
 * First step while scraping a listing: verify company before opening pages / hydrating JD.
 * Returns null when the company should be skipped.
 */
export async function gateCompanyForScrape(
  company: string,
  jdHint?: string
): Promise<CompanyVerifyResult | null> {
  const name = String(company || '').trim();
  if (!name) {
    console.log(`  ↳ Company verify FIRST — skip: missing company name`);
    return null;
  }
  const verified = await verifyCompany(name, jdHint);
  if (verified.skip) {
    console.log(`  ↳ Company verify FIRST — skip (${verified.status}): ${verified.reason}`);
    return null;
  }
  console.log(
    `  ↳ Company verify FIRST — ${verified.status}${verified.domain ? ` · ${verified.domain}` : ''} — ${verified.reason.slice(0, 100)}`
  );
  return verified;
}

/** Sync-only red-flag check (no network) — used in unit tests / fast filters. */
export function detectCompanyRedFlags(
  company: string,
  jobDescription?: string
): { staffing?: string; marketing?: string } {
  return {
    staffing: nameLooksStaffing(company) || undefined,
    marketing: jdLooksProfileMarketing(jobDescription || '') || undefined,
  };
}
