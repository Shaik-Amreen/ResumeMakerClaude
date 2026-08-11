/**
 * Karthik targeting brief (2026-08-10) — scrape / skip / match / fabrication source of truth.
 * Update this file when the candidate changes rules; wire code to these exports.
 */

/** Titles / role types to always skip (non-SWE path). */
export const SKIP_TITLE_PATTERNS: RegExp[] = [
  /\bdata\s+scientist\b/i,
  /\bdata\s+analyst\b/i,
  /\bbusiness\s+analyst\b/i,
  /\bproduct\s+manager\b/i,
  /\bprogram\s+manager\b/i,
  /\bengineering\s+manager\b/i,
  /\b(?:ui\/ux|ux|ui)\s+designer\b/i,
  /\bhardware\s+engineer\b/i,
  /\b(?:it\s+support|help\s*desk)\b/i,
  /\bmanual\s+tester\b/i,
  /\bqa\s+engineer\b/i,
  /\btest\s+engineer\b/i,
  /\bsdet\b/i,
  /\bdevops\b/i,
  /\bsite\s+reliability\b|\bsre\b/i,
  /\bcyber\s*security\b|\binformation\s+security\s+analyst\b/i,
  /\bembedded\b(?!.*\bsoftware\b)/i,
  /\bmachine\s+learning\s+research/i,
  /\bml\s+research/i,
  /\bph\.?d\b.*\b(?:ml|machine\s+learning|research)\b/i,
  /\bsalesforce\b/i,
  /\bsap\b/i,
  /\b(?:senior|staff|principal|sr\.|lead|architect|director|head\s+of)\b/i,
];

/** Soft exception: SDET / QA / DevOps / Salesforce kept when clearly software/backend platform. */
export const TITLE_SOFT_KEEP: RegExp[] = [
  /\b(?:software|backend|full[\s-]?stack|platform)\s+engineer\b/i,
  /\b(?:swe|sde)\b/i,
  /\bnew\s*grad|entry[\s-]?level|university\s+grad\b/i,
];

/** Titles that use soft-keep (otherwise always skip on pattern hit). */
const SOFT_KEEP_ELIGIBLE =
  /\b(?:qa|test\s+engineer|sdet|devops|salesforce|sap)\b/i;

/** JD phrases that block F-1 / OPT (no sponsorship path). */
export const NO_SPONSORSHIP_PATTERNS: RegExp[] = [
  /\bno\s+(?:visa\s+)?sponsorship\b/i,
  /\bwill\s+not\s+sponsor\b/i,
  /\bunable\s+to\s+sponsor\b/i,
  /\bdoes\s+not\s+(?:provide|offer)\s+(?:visa\s+)?sponsorship\b/i,
  /\bnot\s+(?:able|eligible)\s+to\s+sponsor\b/i,
  /\bsponsorship\s+(?:is\s+)?not\s+available\b/i,
  /\bwithout\s+sponsorship\b/i,
  /\bmust\s+(?:already\s+)?be\s+authorized\s+to\s+work\b[\s\S]{0,80}\bwithout\s+sponsorship\b/i,
  /\bno\s+h-?1b\b/i,
  /\bopt\s+(?:not|is\s+not)\s+(?:accepted|eligible|supported)\b/i,
  /\bcpt\s+(?:not|is\s+not)\s+(?:accepted|eligible|supported)\b/i,
  /\bstem\s+opt\s+(?:not|is\s+not)\s+(?:accepted|eligible|supported)\b/i,
  /\bunrestricted\s+(?:work\s+)?authorization\s+required\b/i,
  /\bmust\s+have\s+unrestricted\s+(?:work\s+)?authorization\b/i,
];

export const UNPAID_OR_CONTRACT_PATTERNS: RegExp[] = [
  /\bunpaid\b/i,
  /\bno\s+compensation\b/i,
  /\bvolunteer\s+(?:role|position|internship)\b/i,
  /\bcontract\s+only\b/i,
  /\bcontractor\s+only\b/i,
  /\b1099\s+only\b/i,
  /\bc2c\s+only\b/i,
];

const CODING_HEAVY =
  /\b(?:software|swe|sde|backend|full[\s-]?stack|platform|coding|code|develop(?:er|ment)?|java|python|typescript|javascript|react|node|api|aws)\b/i;

const SOFTWARE_PLATFORM_FOCUS =
  /\b(?:software|platform|backend|full[\s-]?stack|swe|sde|infrastructure\s+software|ml\s+platform|mlops\s+platform)\b/i;

/** Crypto / Web3-only titles (not general SWE at a crypto company). */
export function isCryptoOnlyRole(title: string, description = ''): boolean {
  const t = title.trim();
  if (!/\b(?:crypto|cryptocurrency|web3|blockchain|defi|nft)\b/i.test(t)) return false;
  // Keep if clearly SWE/platform engineering
  if (/\b(?:software|full[\s-]?stack|backend|platform)\s+engineer\b|\b(?:swe|sde)\b/i.test(t)) {
    return false;
  }
  return true;
}

/** ML Engineer kept only when software/platform focused. */
export function isMlEngineerWithoutSoftwareFocus(title: string, description = ''): boolean {
  const t = title.trim();
  if (!/\b(?:machine\s+learning|ml)\s+engineer\b/i.test(t)) return false;
  const text = `${title}\n${description}`;
  return !SOFTWARE_PLATFORM_FOCUS.test(text);
}

/** Solutions / Forward Deployed kept only when coding-heavy. */
export function isSolutionsRoleWithoutCoding(title: string, description = ''): boolean {
  const t = title.trim();
  if (!/\b(?:solutions?\s+engineer|forward[\s-]?deployed)\b/i.test(t)) return false;
  const text = `${title}\n${description}`;
  return !CODING_HEAVY.test(text);
}

/** Prefer official career / ATS over job boards when upgrading duplicates. */
export const SOURCE_QUALITY_RANK: Record<string, number> = {
  company_portal: 100,
  greenhouse: 95,
  lever: 95,
  career_portal: 75,
  linkedin: 65,
  github: 50,
  simplify: 45,
  scoutify: 40,
  jobright: 40,
  indeed: 30,
  other: 10,
};

/** Generic words that must never count as missing skills. */
export const NEVER_MISSING_SKILL_WORDS = [
  'modules',
  'module',
  'tooling',
  'concepts',
  'workflows',
  'best practices',
  'design patterns',
  'agile',
  'collaboration',
  'communication',
  'ownership',
  'customer obsession',
  'problem solving',
  'debugging',
  'troubleshooting',
  'documentation',
  'maintainability',
  'scalability',
  'performance',
  'reliability',
  'clean code',
  'sdlc',
  'cross-functional',
  'fast-paced',
  'ambiguity',
  'production',
  'enterprise',
  'platform',
  'services',
  'systems',
  'applications',
  'derivations',
  'derivation',
  'packages',
  'components',
  'frameworks',
  'libraries',
  'features',
  'pipelines',
  'environments',
];

/** Do not fabricate these even in the 2 open projects. */
export const DO_NOT_FABRICATE_TECH = [
  'Kubernetes',
  'production Kubernetes',
  'Kafka',
  'production Kafka',
  'Terraform',
  'Go',
  'Golang',
  'Rust',
  'C++',
  '.NET',
  'Azure',
  'GCP',
  'Spark',
  'Hadoop',
  'Scala',
  'TensorFlow',
  'PyTorch',
  'LLM training',
  'production ML model training',
  'MLOps',
  'Blockchain',
  'Web3',
  'Salesforce',
  'SAP',
  'Ruby on Rails',
  'Swift',
  'Kotlin',
  'security clearance',
  'Docker',
  'microservices',
  'GraphQL',
];

/** Preferred resume tech emphasis order (top → bottom). */
export const MUST_HAVE_TECH_PRIORITY = [
  'Java',
  'AWS',
  'Python',
  'React',
  'Node.js',
  'Spring Boot',
  'REST APIs',
  'TypeScript',
  'JavaScript',
  'CI/CD',
  'PostgreSQL',
  'MySQL',
  'MongoDB',
  'Redis',
];

export function isNewGradOrEntryTitle(title: string, description = ''): boolean {
  const text = `${title}\n${description}`;
  return /\b(?:new\s*grad|university\s+grad|entry[\s-]?level|associate\s+software|early\s+career|recent\s+grad|equivalent\s+experience)\b/i.test(
    text
  );
}

export function sourceQualityRank(source?: string | null): number {
  if (!source) return SOURCE_QUALITY_RANK.other;
  return SOURCE_QUALITY_RANK[source] ?? SOURCE_QUALITY_RANK.other;
}

export function shouldSkipTargetTitle(title: string): { skip: boolean; reason?: string } {
  const t = title.trim();
  if (!t) return { skip: false };

  for (const re of SKIP_TITLE_PATTERNS) {
    if (!re.test(t)) continue;
    if (SOFT_KEEP_ELIGIBLE.test(t) && TITLE_SOFT_KEEP.some((keep) => keep.test(t))) continue;
    return { skip: true, reason: `Title outside target SWE path: "${title}"` };
  }
  return { skip: false };
}

export function mentionsNoSponsorship(text: string): boolean {
  return NO_SPONSORSHIP_PATTERNS.some((re) => re.test(text));
}

export function isUnpaidOrContractOnly(text: string): boolean {
  return UNPAID_OR_CONTRACT_PATTERNS.some((re) => re.test(text));
}

/** Roles demanding start before MS graduation (Jan 2027). */
export function requiresImmediateStartBeforeGrad(title: string, description: string): boolean {
  const text = `${title}\n${description}`;
  if (
    /\bmust\s+(?:be\s+able\s+to\s+)?start\s+(?:by|before|in)\s+(?:january|february|march|april|may|june|july|august|september|october|november|december)?\s*2026\b/i.test(
      text
    )
  ) {
    return true;
  }
  if (/\b(?:immediate(?:ly)?\s+available|available\s+immediately|start\s+asap)\b/i.test(text)) {
    // New-grad 2027 postings often say "start ASAP after offer" — only skip if not new-grad framed
    if (isNewGradOrEntryTitle(title, description) || /\b2027\b/.test(text)) return false;
    return true;
  }
  return false;
}
