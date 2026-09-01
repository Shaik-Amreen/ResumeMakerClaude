/**
 * Curated H1B + new-grad SWE company quality ratings (1–5).
 * Based on public FY2025–2026 H1B volume / sponsor reputation / product-tier quality.
 * Stars = good sponsor for OPT→H1B path — not raw petition volume alone.
 */

export type CompanyRating = 1 | 2 | 3 | 4 | 5;

export type CompanyRatingResult = {
  rating: CompanyRating;
  reason: string;
  source: 'seed' | 'consulting' | 'jd' | 'default';
};

/** Canonical name → stars. Aliases resolve to these keys via ALIASES. */
const SEED: Record<string, { rating: CompanyRating; label: string }> = {
  // 5 — elite product sponsors
  google: { rating: 5, label: 'Elite H1B product sponsor' },
  meta: { rating: 5, label: 'Elite H1B product sponsor' },
  apple: { rating: 5, label: 'Elite H1B product sponsor' },
  microsoft: { rating: 5, label: 'Elite H1B product sponsor' },
  amazon: { rating: 5, label: 'Elite H1B product sponsor' },
  nvidia: { rating: 5, label: 'Elite H1B product sponsor' },
  netflix: { rating: 5, label: 'Elite H1B product sponsor' },
  stripe: { rating: 5, label: 'Elite H1B product sponsor' },
  databricks: { rating: 5, label: 'Elite H1B product sponsor' },
  openai: { rating: 5, label: 'Elite H1B product sponsor' },
  anthropic: { rating: 5, label: 'Elite H1B product sponsor' },

  // 4 — strong product / fintech / AI
  adobe: { rating: 4, label: 'Strong H1B product sponsor' },
  salesforce: { rating: 4, label: 'Strong H1B product sponsor' },
  uber: { rating: 4, label: 'Strong H1B product sponsor' },
  linkedin: { rating: 4, label: 'Strong H1B product sponsor' },
  snowflake: { rating: 4, label: 'Strong H1B product sponsor' },
  airbnb: { rating: 4, label: 'Strong H1B product sponsor' },
  coinbase: { rating: 4, label: 'Strong H1B product sponsor' },
  palantir: { rating: 4, label: 'Strong H1B product sponsor' },
  bloomberg: { rating: 4, label: 'Strong H1B product sponsor' },
  doordash: { rating: 4, label: 'Strong H1B product sponsor' },
  lyft: { rating: 4, label: 'Strong H1B product sponsor' },
  square: { rating: 4, label: 'Strong H1B product sponsor' },
  block: { rating: 4, label: 'Strong H1B product sponsor' },
  twilio: { rating: 4, label: 'Strong H1B product sponsor' },
  shopify: { rating: 4, label: 'Strong H1B product sponsor' },
  roblox: { rating: 4, label: 'Strong H1B product sponsor' },
  tiktok: { rating: 4, label: 'Strong H1B product sponsor' },
  bytedance: { rating: 4, label: 'Strong H1B product sponsor' },
  snap: { rating: 4, label: 'Strong H1B product sponsor' },
  pinterest: { rating: 4, label: 'Strong H1B product sponsor' },
  spotify: { rating: 4, label: 'Strong H1B product sponsor' },
  dropbox: { rating: 4, label: 'Strong H1B product sponsor' },
  github: { rating: 4, label: 'Strong H1B product sponsor' },
  robinhood: { rating: 4, label: 'Strong H1B product sponsor' },
  rivian: { rating: 4, label: 'Strong H1B product sponsor' },
  tesla: { rating: 4, label: 'Strong H1B product sponsor' },
  amd: { rating: 4, label: 'Strong H1B product sponsor' },
  intuit: { rating: 4, label: 'Strong H1B product sponsor' },
  paypal: { rating: 4, label: 'Strong H1B product sponsor' },

  // 3 — solid mid/large sponsors
  cisco: { rating: 3, label: 'Solid mid/large H1B sponsor' },
  intel: { rating: 3, label: 'Solid mid/large H1B sponsor' },
  oracle: { rating: 3, label: 'Solid mid/large H1B sponsor' },
  qualcomm: { rating: 3, label: 'Solid mid/large H1B sponsor' },
  jpmorgan: { rating: 3, label: 'Solid mid/large H1B sponsor' },
  goldman: { rating: 3, label: 'Solid mid/large H1B sponsor' },
  'capital one': { rating: 3, label: 'Solid mid/large H1B sponsor' },
  servicenow: { rating: 3, label: 'Solid mid/large H1B sponsor' },
  atlassian: { rating: 3, label: 'Solid mid/large H1B sponsor' },
  visa: { rating: 3, label: 'Solid mid/large H1B sponsor' },
  mastercard: { rating: 3, label: 'Solid mid/large H1B sponsor' },
  ibm: { rating: 3, label: 'Solid mid/large H1B sponsor' },
  dell: { rating: 3, label: 'Solid mid/large H1B sponsor' },
  vmware: { rating: 3, label: 'Solid mid/large H1B sponsor' },
  workday: { rating: 3, label: 'Solid mid/large H1B sponsor' },
  splunk: { rating: 3, label: 'Solid mid/large H1B sponsor' },
  mongodb: { rating: 3, label: 'Solid mid/large H1B sponsor' },
  elastic: { rating: 3, label: 'Solid mid/large H1B sponsor' },
  datadog: { rating: 3, label: 'Solid mid/large H1B sponsor' },
  cloudflare: { rating: 3, label: 'Solid mid/large H1B sponsor' },
  zoom: { rating: 3, label: 'Solid mid/large H1B sponsor' },
  slack: { rating: 3, label: 'Solid mid/large H1B sponsor' },
  box: { rating: 3, label: 'Solid mid/large H1B sponsor' },
  'morgan stanley': { rating: 3, label: 'Solid mid/large H1B sponsor' },
  citi: { rating: 3, label: 'Solid mid/large H1B sponsor' },
  'bank of america': { rating: 3, label: 'Solid mid/large H1B sponsor' },
  'wells fargo': { rating: 3, label: 'Solid mid/large H1B sponsor' },
  walmart: { rating: 3, label: 'Solid mid/large H1B sponsor' },
  target: { rating: 3, label: 'Solid mid/large H1B sponsor' },
  nike: { rating: 3, label: 'Solid mid/large H1B sponsor' },
  disney: { rating: 3, label: 'Solid mid/large H1B sponsor' },
  comcast: { rating: 3, label: 'Solid mid/large H1B sponsor' },
  verizon: { rating: 3, label: 'Solid mid/large H1B sponsor' },
  att: { rating: 3, label: 'Solid mid/large H1B sponsor' },
  broadcom: { rating: 3, label: 'Solid mid/large H1B sponsor' },
  micron: { rating: 3, label: 'Solid mid/large H1B sponsor' },
  'applied materials': { rating: 3, label: 'Solid mid/large H1B sponsor' },
  accenture: { rating: 3, label: 'Consulting / advisory H1B sponsor' },
  deloitte: { rating: 3, label: 'Consulting / advisory H1B sponsor' },
  ey: { rating: 3, label: 'Consulting / advisory H1B sponsor' },
  pwc: { rating: 3, label: 'Consulting / advisory H1B sponsor' },
  kpmg: { rating: 3, label: 'Consulting / advisory H1B sponsor' },

  // 2 — high-volume IT consulting (volume ≠ new-grad lottery quality)
  cognizant: { rating: 2, label: 'High-volume IT consulting H1B' },
  infosys: { rating: 2, label: 'High-volume IT consulting H1B' },
  tcs: { rating: 2, label: 'High-volume IT consulting H1B' },
  wipro: { rating: 2, label: 'High-volume IT consulting H1B' },
  hcl: { rating: 2, label: 'High-volume IT consulting H1B' },
  capgemini: { rating: 2, label: 'High-volume IT consulting H1B' },
  'tech mahindra': { rating: 2, label: 'High-volume IT consulting H1B' },
  ltimindtree: { rating: 2, label: 'High-volume IT consulting H1B' },
  mindtree: { rating: 2, label: 'High-volume IT consulting H1B' },
};

/** Alias → SEED key */
const ALIASES: Record<string, string> = {
  alphabet: 'google',
  'google llc': 'google',
  'google inc': 'google',
  'meta platforms': 'meta',
  'meta platforms inc': 'meta',
  facebook: 'meta',
  'amazon.com': 'amazon',
  'amazon web services': 'amazon',
  aws: 'amazon',
  'microsoft corporation': 'microsoft',
  'apple inc': 'apple',
  'nvidia corporation': 'nvidia',
  'netflix inc': 'netflix',
  'stripe inc': 'stripe',
  'databricks inc': 'databricks',
  'open ai': 'openai',
  'salesforce.com': 'salesforce',
  'adobe systems': 'adobe',
  'adobe inc': 'adobe',
  'linkedin corporation': 'linkedin',
  'uber technologies': 'uber',
  'snowflake inc': 'snowflake',
  'airbnb inc': 'airbnb',
  'coinbase inc': 'coinbase',
  'palantir technologies': 'palantir',
  'bloomberg lp': 'bloomberg',
  'doordash inc': 'doordash',
  'block inc': 'block',
  'square inc': 'square',
  'bytedance inc': 'bytedance',
  'tiktok inc': 'tiktok',
  'snap inc': 'snap',
  'pinterest inc': 'pinterest',
  'spotify ab': 'spotify',
  'dropbox inc': 'dropbox',
  'github inc': 'github',
  'robinhood markets': 'robinhood',
  'tesla inc': 'tesla',
  'advanced micro devices': 'amd',
  'intuit inc': 'intuit',
  'paypal holdings': 'paypal',
  'cisco systems': 'cisco',
  'intel corporation': 'intel',
  'oracle corporation': 'oracle',
  'qualcomm incorporated': 'qualcomm',
  'jpmorgan chase': 'jpmorgan',
  'jp morgan': 'jpmorgan',
  'jp morgan chase': 'jpmorgan',
  'chase bank': 'jpmorgan',
  'goldman sachs': 'goldman',
  'the goldman sachs group': 'goldman',
  'capital one financial': 'capital one',
  'servicenow inc': 'servicenow',
  'atlassian corporation': 'atlassian',
  'visa inc': 'visa',
  'mastercard incorporated': 'mastercard',
  'international business machines': 'ibm',
  'dell technologies': 'dell',
  'vmware inc': 'vmware',
  'workday inc': 'workday',
  'splunk inc': 'splunk',
  'mongodb inc': 'mongodb',
  'elastic n.v': 'elastic',
  'elastic nv': 'elastic',
  'datadog inc': 'datadog',
  'cloudflare inc': 'cloudflare',
  'zoom video communications': 'zoom',
  'slack technologies': 'slack',
  'box inc': 'box',
  'morgan stanley': 'morgan stanley',
  citigroup: 'citi',
  'citibank': 'citi',
  'bank of america corporation': 'bank of america',
  'wells fargo & company': 'wells fargo',
  'walmart inc': 'walmart',
  'target corporation': 'target',
  'nike inc': 'nike',
  'the walt disney company': 'disney',
  'walt disney': 'disney',
  'comcast corporation': 'comcast',
  'verizon communications': 'verizon',
  'at&t': 'att',
  'at and t': 'att',
  'broadcom inc': 'broadcom',
  'micron technology': 'micron',
  'applied materials inc': 'applied materials',
  'accenture plc': 'accenture',
  'deloitte consulting': 'deloitte',
  'deloitte llp': 'deloitte',
  'ernst & young': 'ey',
  'ernst and young': 'ey',
  'pricewaterhousecoopers': 'pwc',
  'pwc llp': 'pwc',
  'kpmg llp': 'kpmg',
  'cognizant technology solutions': 'cognizant',
  'infosys limited': 'infosys',
  'infosys ltd': 'infosys',
  'tata consultancy services': 'tcs',
  'tata consultancy': 'tcs',
  'wipro limited': 'wipro',
  'wipro ltd': 'wipro',
  'hcl technologies': 'hcl',
  'hcltech': 'hcl',
  'capgemini america': 'capgemini',
  'tech mahindra limited': 'tech mahindra',
  'lti mindtree': 'ltimindtree',
  'larsen & toubro': 'ltimindtree',
};

const CONSULTING_KEYS = new Set([
  'cognizant',
  'infosys',
  'tcs',
  'wipro',
  'hcl',
  'capgemini',
  'tech mahindra',
  'ltimindtree',
  'mindtree',
]);

export function normalizeCompanyName(name: string): string {
  return String(name || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s.]/g, ' ')
    .replace(/\b(inc|incorporated|llc|ltd|limited|corp|corporation|co|company|plc|n\.?v\.?|lp|group|holdings?)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function clampRating(n: number): CompanyRating {
  return Math.max(1, Math.min(5, Math.round(n))) as CompanyRating;
}

function lookupSeedKey(normalized: string): string | null {
  if (!normalized) return null;
  if (ALIASES[normalized]) return ALIASES[normalized];
  if (SEED[normalized]) return normalized;

  // Longest alias / seed key contained in name or vice versa
  let best: string | null = null;
  let bestLen = 0;
  const candidates = [...Object.keys(ALIASES), ...Object.keys(SEED)];
  for (const key of candidates) {
    if (key.length < 3) continue;
    if (normalized === key || normalized.includes(key) || key.includes(normalized)) {
      if (key.length > bestLen) {
        bestLen = key.length;
        best = ALIASES[key] || key;
      }
    }
  }
  return best && SEED[best] ? best : null;
}

function jdForcesNoSponsorship(jd: string): boolean {
  const t = jd.toLowerCase();
  return (
    /no\s+(visa\s+)?sponsorship/i.test(t) ||
    /without\s+(visa\s+)?sponsorship/i.test(t) ||
    /does\s+not\s+(offer|provide|sponsor).*sponsorship/i.test(t) ||
    /will\s+not\s+sponsor/i.test(t) ||
    /u\.?\s*s\.?\s*citizen(s)?\s+only/i.test(t) ||
    /citizens?\s+only/i.test(t) ||
    /must\s+be\s+(a\s+)?(u\.?\s*s\.?\s*)?citizen/i.test(t) ||
    /green\s+card\s+(holders?\s+)?only/i.test(t) ||
    /clearance\s+required/i.test(t)
  );
}

function jdMentionsSponsorship(jd: string): boolean {
  const t = jd.toLowerCase();
  return (
    /will\s+sponsor/i.test(t) ||
    /sponsors?\s+h-?1b/i.test(t) ||
    /visa\s+sponsorship\s+(is\s+)?available/i.test(t) ||
    /open\s+to\s+sponsorship/i.test(t) ||
    /h-?1b\s+(visa\s+)?(sponsorship|transfer)/i.test(t)
  );
}

/**
 * Resolve 1–5 company rating for scrape / backfill.
 * JD “no sponsorship” forces 1; explicit sponsor language can bump +1 (cap 5).
 */
export function resolveCompanyRating(
  company: string,
  jobDescription?: string
): CompanyRatingResult {
  const jd = String(jobDescription || '');
  if (jd && jdForcesNoSponsorship(jd)) {
    return {
      rating: 1,
      reason: 'JD refuses sponsorship / citizens-only',
      source: 'jd',
    };
  }

  const norm = normalizeCompanyName(company);
  const seedKey = lookupSeedKey(norm);

  let rating: CompanyRating = 2;
  let reason = 'Unknown company (default)';
  let source: CompanyRatingResult['source'] = 'default';

  if (seedKey && SEED[seedKey]) {
    const entry = SEED[seedKey];
    rating = entry.rating;
    reason = entry.label;
    source = CONSULTING_KEYS.has(seedKey) ? 'consulting' : 'seed';
  }

  if (jd && jdMentionsSponsorship(jd) && rating < 5) {
    rating = clampRating(rating + 1);
    reason = `${reason} · JD mentions sponsorship (+1)`;
    source = source === 'default' ? 'jd' : source;
  }

  return { rating, reason, source };
}

/** Count of distinct curated companies (for docs/tests). */
export function h1bSeedCompanyCount(): number {
  return Object.keys(SEED).length;
}
