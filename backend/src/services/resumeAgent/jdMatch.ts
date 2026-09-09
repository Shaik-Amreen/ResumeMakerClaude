/**
 * Extract required-ish keywords from a JD and score how well LaTeX covers them.
 * Goal: surface missing skills so the resume agent can revise to ~100% coverage.
 * Only real tech tokens — never HTML tags, prose phrases, or UI chrome.
 */

import {
  DO_NOT_FABRICATE_TECH,
  NEVER_MISSING_SKILL_WORDS,
} from '../../data/candidateTargeting';
import { cleanJobDescriptionForResume } from '../cleanJobDescription';

const STOP = new Set([
  'and', 'or', 'the', 'a', 'an', 'to', 'of', 'in', 'for', 'with', 'on', 'at', 'by',
  'as', 'is', 'are', 'be', 'will', 'you', 'your', 'our', 'we', 'this', 'that',
  'from', 'into', 'over', 'under', 'able', 'using', 'use', 'used', 'work', 'working',
  'experience', 'years', 'year', 'including', 'related', 'strong', 'preferred',
  'required', 'requirements', 'qualifications', 'responsibilities', 'about', 'role',
  'team', 'company', 'job', 'position', 'internship', 'intern', 'summer', 'must',
  'have', 'has', 'plus', 'etc', 'other', 'such', 'across', 'within', 'knowledge',
  'skills', 'abilities', 'proficiency', 'familiarity', 'exposure', 'judgment',
  'diplomacy', 'nbsp', 'strong', 'p', 'div', 'span', 'li', 'ul',
  // Generic software words — appear inside project bullets by default; not standalone skills
  'module', 'modules', 'derivation', 'derivations', 'package', 'packages',
  'component', 'components', 'service', 'services', 'system', 'systems',
  'tool', 'tools', 'tooling', 'framework', 'frameworks', 'library', 'libraries',
  'test', 'tests', 'testing', 'feature', 'features', 'platform', 'platforms',
  'application', 'applications', 'pipeline', 'pipelines', 'environment', 'environments',
  ...NEVER_MISSING_SKILL_WORDS.map((w) => w.toLowerCase()),
]);

/**
 * Generic / compositional tokens that should never be "missing skill" blockers.
 * e.g. Nix "modules"/"derivations", "VM tests" — covered by projects/CI by default.
 */
const GENERIC_SKILL_PHRASES = [
  /^modules?$/i,
  /^derivations?$/i,
  /^packages?$/i,
  /^components?$/i,
  /^vm\s*tests?$/i,
  /^unit\s*tests?$/i,
  /^integration\s*tests?$/i,
  /^end[- ]to[- ]end\s*tests?$/i,
  /^e2e\s*tests?$/i,
  /^test\s*labs?$/i,
  /^cli\s*tooling$/i,
  /^production\s*ci$/i,
  /^self[- ]hosted\s*runners?$/i,
  /^large[- ]scale\s*test/i,
  /^debugging\s*flaky/i,
  /^hardware\s*test\s*frameworks?$/i,
  /^target\s*bring[- ]?up$/i,
  /^ci\/?hil\s*concepts?$/i,
  /^systems?\s*administration$/i,
  /^bare[- ]metal\s*linux/i,
  /^embedded\s*devices?$/i,
  /^ci\/cd\s*pipeline\s*design$/i,
  /^best\s*practices?$/i,
  /^design\s*patterns?$/i,
  /^problem\s*solving$/i,
  /^customer\s*obsession$/i,
  /^clean\s*code$/i,
  /^cross[- ]functional$/i,
  /^fast[- ]paced$/i,
  /^sdlc$/i,
  /^maintainability$/i,
  /^scalability$/i,
  /^reliability$/i,
  /^collaboration$/i,
  /^communication$/i,
  /^ownership$/i,
  /^workflows?$/i,
  /^concepts?$/i,
  /^tooling$/i,
  /^agile$/i,
  /^ambiguity$/i,
  /^production$/i,
  /^enterprise$/i,
];

/** Canonical tech skills we score / inject. Display form is the Map value. */
const TECH_PATTERNS: Array<{ re: RegExp; display: string }> = [
  { re: /\bc#|\bc sharp\b/gi, display: 'C#' },
  { re: /\.net\b|dotnet\b|asp\.?\s*net|asp\s*mvc\b/gi, display: '.NET' },
  { re: /\bjava\b(?!\s*script)/gi, display: 'Java' },
  { re: /\bc\+\+\b/gi, display: 'C++' },
  { re: /\bpython\b/gi, display: 'Python' },
  { re: /\btypescript\b/gi, display: 'TypeScript' },
  { re: /\bjavascript\b/gi, display: 'JavaScript' },
  { re: /\bgo(?:lang)?\b/gi, display: 'Go' },
  { re: /\brust\b/gi, display: 'Rust' },
  { re: /\bkotlin\b/gi, display: 'Kotlin' },
  { re: /\bswift\b/gi, display: 'Swift' },
  { re: /\bphp\b/gi, display: 'PHP' },
  { re: /\bsql\b/gi, display: 'SQL' },
  { re: /\bpostgresql|postgres\b/gi, display: 'PostgreSQL' },
  { re: /\bmysql\b/gi, display: 'MySQL' },
  { re: /\bmongodb\b/gi, display: 'MongoDB' },
  { re: /\bredis\b/gi, display: 'Redis' },
  { re: /\brabbitmq\b/gi, display: 'RabbitMQ' },
  { re: /\bkafka\b/gi, display: 'Kafka' },
  { re: /\bgraphql\b/gi, display: 'GraphQL' },
  { re: /\brest(?:ful)?(?:\s*apis?)?\b/gi, display: 'REST APIs' },
  { re: /\breact\s*native\b/gi, display: 'React Native' },
  { re: /\breact(?:js|\.js)?\b/gi, display: 'React' },
  { re: /\bnext\.?js\b/gi, display: 'Next.js' },
  { re: /\bnode(?:\.?js)?\b/gi, display: 'Node.js' },
  { re: /\bexpress(?:\.?js)?\b/gi, display: 'Express' },
  { re: /\bangular\b/gi, display: 'Angular' },
  { re: /\bvue(?:\.?js)?\b/gi, display: 'Vue' },
  { re: /\bredux\b/gi, display: 'Redux' },
  { re: /\btailwind\b/gi, display: 'Tailwind' },
  { re: /\bbootstrap\b/gi, display: 'Bootstrap' },
  { re: /\bhtml5?\b/gi, display: 'HTML' },
  { re: /\bcss3?\b/gi, display: 'CSS' },
  { re: /\bdocker\b/gi, display: 'Docker' },
  { re: /\bkubernetes|k8s\b/gi, display: 'Kubernetes' },
  { re: /\bci\/cd\b/gi, display: 'CI/CD' },
  { re: /\bprometheus\b/gi, display: 'Prometheus' },
  { re: /\bgrafana\b/gi, display: 'Grafana' },
  { re: /\bopentelemetry\b/gi, display: 'OpenTelemetry' },
  { re: /\baws\b/gi, display: 'AWS' },
  { re: /\bazure\b/gi, display: 'Azure' },
  { re: /\bgcp|google cloud\b/gi, display: 'GCP' },
  { re: /\bterraform\b/gi, display: 'Terraform' },
  { re: /\bspring\s*boot\b/gi, display: 'Spring Boot' },
  { re: /\bdjango\b/gi, display: 'Django' },
  { re: /\bflask\b/gi, display: 'Flask' },
  { re: /\bfastapi\b/gi, display: 'FastAPI' },
  { re: /\bmicroservices?\b/gi, display: 'microservices' },
  { re: /\bevent[- ]driven\b/gi, display: 'event-driven systems' },
  { re: /\bdistributed systems?\b/gi, display: 'distributed systems' },
  { re: /\bsolid(?:\s+principles?)?\b/gi, display: 'SOLID' },
  { re: /\bobject[- ]oriented(?:\s+design)?\b|\bOOD\b|\bOOP\b/gi, display: 'OOD' },
  { re: /\bthread[- ]safe\b|\bconcurrency\b/gi, display: 'concurrency' },
  { re: /\bagile|scrum\b/gi, display: 'Agile' },
  { re: /\bandroid\b/gi, display: 'Android' },
  { re: /\btcp\/ip\b|\budp\b|socket\s+programming\b/gi, display: 'socket programming' },
  { re: /\bplc\b|programmable logic controller/gi, display: 'PLC' },
  { re: /\bwarehouse\b|logistics\b|supply\s+chain\b/gi, display: 'warehouse systems' },
  { re: /\biot\b|internet[- ]of[- ]things\b/gi, display: 'IoT' },
  { re: /\bgit(?:hub|lab)?\b/gi, display: 'Git' },
  { re: /\blinux\b/gi, display: 'Linux' },
];

function normalizeSkill(s: string): string {
  let out = s
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\.js\b/g, '')
    .trim();
  out = out.replace(/^c\+\+\s*\d+.*$/, 'c++').replace(/^c\+\+$/, 'c++');
  return out;
}

/** Reject HTML residue / prose / UI chrome / generic project words. */
export function isJunkSkillToken(token: string): boolean {
  const t = token.trim().replace(/[.,;:]+$/g, '');
  if (t.length < 2 || t.length > 36) return true;
  if (/[.!?]/.test(t)) return true;
  if ((t.match(/\s+/g) || []).length >= 3) return true; // 4+ words = prose
  if (/<\/?[a-z]|^\s*p\b|&nbsp;|nbsp|strong|div|span|font-size|FeedBlock|Themeable/i.test(t)) {
    return true;
  }
  if (GENERIC_SKILL_PHRASES.some((re) => re.test(t))) return true;
  if (
    /\b(knowledge|abilities|proficiency|familiarity|diplomacy|judgment|escalat|identify|troubleshoot and resolve|sound judgment|preferred|required|plus|concepts|build|design|ship|bring|demonstrated|ability|physical|world|you'll|internship|production systems|what you|prior|collaborative|firmware|batteries|ercot|participate|shadow|partner|modules?|derivations?|scalability|maintainability|reliability|ownership|collaboration|communication|workflows?|tooling|ambiguity|enterprise|sdlc|clean code|best practices|design patterns|problem solving|customer obsession|cross-functional|fast-paced)\b/i.test(
      t
    )
  ) {
    return true;
  }
  if (NEVER_MISSING_SKILL_WORDS.some((w) => normalizeSkill(t) === w.toLowerCase())) {
    return true;
  }
  if (STOP.has(normalizeSkill(t))) return true;
  // Pure prose phrases (no tech markers)
  if (/^[a-z][a-z\s]+$/i.test(t) && !/[+#/\d]/.test(t) && t.split(/\s+/).length >= 2) {
    if (!/\b(api|rest|sql|oop|ood|ci|cd|iot|tcp|udp|mvc|aws|gcp|net)\b/i.test(t)) return true;
  }
  return false;
}

/** Drop junk / generic tokens from LLM or regex keyword lists. */
export function filterSkillTokens(tokens: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of tokens) {
    const t = String(raw || '').trim();
    if (!t || isJunkSkillToken(t)) continue;
    const key = normalizeSkill(t);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

/** True if resume plain text already covers this keyword (C++ covers C++20/23). */
function keywordCovered(plain: string, kw: string): boolean {
  const key = normalizeSkill(kw);
  if (key === 'c++' || /^c\+\+/i.test(kw.replace(/\s+/g, ''))) {
    return /\bc\+\+/.test(plain);
  }
  if (key === 'c#' || key === 'c sharp') {
    return /\bc#|c sharp|\.net\b/.test(plain);
  }
  if (key === '.net' || key === 'dotnet' || /asp/.test(key)) {
    return /\.net|dotnet|asp\.?\s*net|asp\s*mvc|c#/.test(plain);
  }
  // "REST APIs" matches REST, RESTful, REST/GraphQL APIs, etc.
  if (key === 'rest apis' || key === 'rest api' || key === 'rest') {
    return /\brest(?:ful)?(?:\s*\/\s*graphql)?(?:\s*apis?)?\b/.test(plain);
  }
  // Short tokens need word boundaries — "go" must not match play.google.com
  if (key === 'go' || key === 'golang') {
    return /\bgo(?:lang)?\b/.test(plain);
  }
  if (key === 'r' || key === 'c') {
    return new RegExp(`\\b${key}\\b`).test(plain);
  }
  if (key === 'rust') {
    return /\brust\b/.test(plain);
  }
  if (key === 'java') {
    return /\bjava\b(?!\s*script)/.test(plain);
  }
  const variants = [
    key,
    key.replace(/\./g, ''),
    key.replace(/\s+/g, ''),
    key.replace(/-/g, ' '),
  ];
  return variants.some((v) => v.length >= 2 && plain.includes(v));
}

/** Hard bans from fabrication policy — never inject into Experience/Skills. */
function isFabricationBanned(token: string): boolean {
  const key = normalizeSkill(token);
  return DO_NOT_FABRICATE_TECH.some((banned) => {
    const b = normalizeSkill(banned);
    if (key === b) return true;
    // Avoid tiny tokens (e.g. "go") false-positive matching longer unrelated strings
    if (b.length >= 4 && key.length >= 4 && (key.includes(b) || b.includes(key))) return true;
    return false;
  });
}

/** Canonical display for known tech tokens. */
function canonicalTechDisplay(token: string): string | null {
  const t = token.trim();
  for (const { re, display } of TECH_PATTERNS) {
    re.lastIndex = 0;
    if (re.test(t) || normalizeSkill(t) === normalizeSkill(display)) return display;
  }
  if (
    TECH_PATTERNS.some((p) => {
      p.re.lastIndex = 0;
      return p.re.test(t);
    })
  ) {
    return t;
  }
  return null;
}

function latexToPlain(latex: string): string {
  return latex
    .replace(/%.*$/gm, ' ')
    .replace(/\\#/g, '#')
    .replace(/\\&/g, '&')
    .replace(/\\[a-zA-Z]+\*?/g, ' ')
    .replace(/[{}\[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function extractSection(jd: string, ...headers: string[]): string {
  const lower = jd.toLowerCase();
  for (const h of headers) {
    const idx = lower.indexOf(h.toLowerCase());
    if (idx < 0) continue;
    const slice = jd.slice(idx, idx + 3500);
    const next = slice.search(
      /\n\s*(about the|benefits|perks|compensation|what we offer|equal opportunity|eeo|physical demands|work environment)\b/i
    );
    return next > 80 ? slice.slice(0, next) : slice;
  }
  return '';
}

/** Collect JD keywords we expect on a strong tailored resume. */
export function extractJdKeywords(jobDescription: string): string[] {
  const jd = cleanJobDescriptionForResume(jobDescription || '');
  // Prefer skills/qualifications blocks, but ALWAYS also scan the full JD —
  // locking onto "Experience Requirements" alone drops C#/Java/Docker lines above it.
  const skillsBlock =
    extractSection(
      jd,
      'knowledge, skills and abilities',
      'knowledge, skills',
      'minimum qualifications',
      'preferred qualifications',
      'basic qualifications',
      'qualifications',
      'what you',
      'must have',
      'job expectations',
      'responsibilities',
      'skills'
    ) || '';
  const focus = `${skillsBlock}\n${jd}`.slice(0, 9000);

  const found = new Map<string, string>();

  for (const { re, display } of TECH_PATTERNS) {
    re.lastIndex = 0;
    if (!re.test(focus)) continue;
    const key = normalizeSkill(display);
    if (key.length < 2 || STOP.has(key) || isJunkSkillToken(display)) continue;
    if (!found.has(key)) found.set(key, display);
  }

  return [...found.values()].slice(0, 28);
}

export interface JdMatchResult {
  score: number;
  matched: string[];
  missing: string[];
  keywords: string[];
}

/** Persist keyword + resume match fields on a job document (mutates, does not save). */
export function applyMatchFieldsToJob(
  job: {
    matchScore?: number;
    keywordMatchScore?: number;
    matchedKeywords?: string[];
    missingKeywords?: string[];
    skillGaps?: string[];
  },
  match: JdMatchResult,
  extras?: { skillGaps?: string[]; resumeMatchScore?: number }
): void {
  job.keywordMatchScore = match.score;
  job.matchScore = extras?.resumeMatchScore ?? match.score;
  job.matchedKeywords = match.matched;
  job.missingKeywords = match.missing;
  const gaps =
    extras?.skillGaps && extras.skillGaps.length
      ? extras.skillGaps
      : buildDefaultSkillGaps(match.missing);
  job.skillGaps = gaps;
}

/** Human-readable gaps when the model did not return skillGaps. */
export function buildDefaultSkillGaps(missing: string[]): string[] {
  return missing
    .map((m) => m.trim())
    .filter(Boolean)
    .slice(0, 18)
    .map(
      (m) =>
        `"${m}" is required by the JD but not evidenced in an Experience or Project bullet (listing it only under Skills does not count).`
    );
}

/** Prefer Claude/LLM match report; fill holes with regex tech coverage. */
export function mergeLlmAndRegexMatch(
  llm: {
    jdSkills: string[];
    matched: string[];
    missing: string[];
    skillGaps: string[];
    keywordMatchScore: number;
    resumeMatchScore: number;
  } | undefined,
  regex: JdMatchResult
): { match: JdMatchResult; skillGaps: string[]; resumeMatchScore: number } {
  if (!llm) {
    return {
      match: regex,
      skillGaps: buildDefaultSkillGaps(regex.missing),
      resumeMatchScore: regex.score,
    };
  }

  const matched = filterSkillTokens([...llm.matched, ...regex.matched]);
  const matchedLower = new Set(matched.map((s) => s.toLowerCase()));
  const missingFromLlm = filterSkillTokens(llm.missing).filter(
    (s) => !matchedLower.has(s.toLowerCase())
  );
  // Also surface regex-missing that LLM forgot to list
  for (const m of filterSkillTokens(regex.missing)) {
    if (matchedLower.has(m.toLowerCase())) continue;
    if (!missingFromLlm.some((x) => x.toLowerCase() === m.toLowerCase())) {
      missingFromLlm.push(m);
    }
  }

  const keywords = filterSkillTokens([
    ...(llm.jdSkills.length ? llm.jdSkills : regex.keywords),
    ...matched,
    ...missingFromLlm,
  ]).slice(0, 40);

  const missing = missingFromLlm;
  const score =
    keywords.length === 0
      ? 100
      : Math.round((matched.length / Math.max(matched.length + missing.length, 1)) * 100);

  const llmGaps = (llm.skillGaps || [])
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((g) => {
      const quoted = g.match(/"([^"]+)"/);
      if (quoted && isJunkSkillToken(quoted[1])) return false;
      if (/\b(?:modules?|derivations?|vm\s*tests?)\b/i.test(g) && !missing.length) return false;
      return true;
    });
  const explained = new Set(
    llmGaps.flatMap((g) =>
      missing
        .filter((m) => g.toLowerCase().includes(m.toLowerCase()))
        .map((m) => m.toLowerCase())
    )
  );
  const autoGaps = buildDefaultSkillGaps(
    missing.filter((m) => !explained.has(m.toLowerCase()))
  );
  const skillGaps = [...llmGaps, ...autoGaps].slice(0, 20);

  return {
    match: {
      score: llm.keywordMatchScore || score,
      matched,
      missing,
      keywords,
    },
    skillGaps: skillGaps.length ? skillGaps : buildDefaultSkillGaps(missing),
    resumeMatchScore: llm.resumeMatchScore || llm.keywordMatchScore || score,
  };
}

export function scoreResumeAgainstJd(jobDescription: string, latex: string): JdMatchResult {
  const keywords = extractJdKeywords(jobDescription);
  const plain = latexToPlain(latex);
  const matched: string[] = [];
  const missing: string[] = [];

  for (const kw of keywords) {
    if (keywordCovered(plain, kw)) matched.push(kw);
    else missing.push(kw);
  }

  const score =
    keywords.length === 0 ? 100 : Math.round((matched.length / keywords.length) * 100);

  return { score, matched, missing, keywords };
}

/** Treat exact 100% keyword coverage (or no extractable keywords) as full match. */
export function isFullJdMatch(result: JdMatchResult): boolean {
  if (result.keywords.length === 0) return true;
  return result.missing.length === 0 && result.score >= 100;
}

/** Count live project URLs in Key Projects / Featured Projects. */
export function countLinkedFeaturedProjects(latex: string): number {
  const projects =
    latex.match(
      /\\section\{\\textbf\{(?:Key Projects|Featured Projects)\}\}([\s\S]*?)(?=\\section\{\\textbf\{(?:Education|Publications|Certifications)|\\end\{document\})/i
    )?.[1] || '';
  const known = [
    'nativenest.in',
    'origemindia.com',
    'arikya.in',
    'arikya.com',
    'bookingbee.ai',
    'jobtracker.karthikkovi.com',
    'karthikkovi.com',
    'asicsulb.org',
    'apps.apple.com',
    'play.google.com',
  ];
  const hrefs = [...projects.matchAll(/\\href\{(https?:\/\/[^}]+)\}/gi)].map((m) =>
    m[1].toLowerCase()
  );
  const titles = [
    ...projects.matchAll(/\\href\{https?:\/\/[^}]+\}\{(?:\\uline\{\\textbf\{|\\textbf\{)([^}]+)/gi),
  ];
  if (titles.length >= 3) return titles.length;
  const linked = hrefs.filter((u) => known.some((k) => u.includes(k)));
  const hosts = new Set(
    linked.map((u) => {
      try {
        return new URL(u).hostname.replace(/^www\./, '');
      } catch {
        return u;
      }
    })
  );
  hosts.delete('apps.apple.com');
  hosts.delete('play.google.com');
  return hosts.size;
}

export function hasEnoughLinkedProjects(latex: string, min = 3): boolean {
  return countLinkedFeaturedProjects(latex) >= min;
}

/** Escape tokens so they are safe inside normal LaTeX text (not verbatim). */
function latexSafeToken(s: string): string {
  // Keep C# hash — only strip LaTeX-breaking braces/percent/underscore/amp
  return s
    .replace(/\\/g, '')
    .replace(/[{}%_]/g, '')
    .replace(/&/g, '\\&')
    .replace(/#/g, '\\#')
    .trim();
}

/**
 * Deterministically fold missing JD keywords into Skills AND Experience bullets.
 * Prefer Infobell for C#/desktop; ASI for REST/API/backend; Skills for the rest.
 */
export function injectMissingJdKeywords(latex: string, missing: string[]): string {
  const plain = latexToPlain(latex);
  const languageNames = new Set(
    [
      'python',
      'java',
      'javascript',
      'typescript',
      'sql',
      'go',
      'c++',
      'c#',
      'php',
      'rust',
      'kotlin',
      'swift',
      'html',
      'css',
      'bash',
      'perl',
      'shell',
      'r',
      'scala',
    ].map((s) => s.toLowerCase())
  );

  const tokens: string[] = [];
  const seen = new Set<string>();
  for (const raw of missing) {
    const display = canonicalTechDisplay(raw) || raw.trim();
    if (!display || isJunkSkillToken(display)) continue;
    if (isFabricationBanned(display)) continue;
    if (keywordCovered(plain, display)) continue;
    const key = normalizeSkill(display);
    if (seen.has(key)) continue;
    seen.add(key);
    tokens.push(display);
    if (tokens.length >= 10) break;
  }
  if (!tokens.length) {
    // Still normalize REST → REST APIs on Skills when JD asked for REST APIs
    return normalizeRestOnSkills(latex);
  }

  let out = normalizeRestOnSkills(latex);
  out = injectIntoSkillsSection(out, tokens, languageNames);
  out = injectIntoExperienceBullets(out, tokens);
  return out;
}

function normalizeRestOnSkills(latex: string): string {
  return latex.replace(/(\\textbf\{Backend:\}[^\\\n]*)/i, (line) => {
    if (/REST\s*APIs/i.test(line)) return line;
    if (/\bREST\b/i.test(line)) return line.replace(/\bREST\b/, 'REST APIs');
    return line;
  });
}

function injectIntoSkillsSection(
  latex: string,
  tokens: string[],
  languageNames: Set<string>
): string {
  const plain = latexToPlain(latex);
  const stillMissing = tokens.filter((t) => !keywordCovered(plain, t));
  if (!stillMissing.length) return latex;

  const langTokens = stillMissing
    .filter((t) => languageNames.has(normalizeSkill(t).replace(/\(es6\+?\)/, '').trim()))
    .map(latexSafeToken);
  const otherTokens = stillMissing
    .filter((t) => !languageNames.has(normalizeSkill(t).replace(/\(es6\+?\)/, '').trim()))
    .map(latexSafeToken);

  let out = latex;
  if (langTokens.length && /\\textbf\{Languages:\}/i.test(out)) {
    const joined = langTokens.join(', ');
    out = out.replace(/(\\textbf\{Languages:\}[^\\\n]*)/i, `$1, ${joined}`);
  }

  // Prefer Backend line for API / server tech
  const backendish = otherTokens.filter((t) =>
    /rest|api|express|spring|fastapi|graphql|microservices|node/i.test(t)
  );
  const restOther = otherTokens.filter((t) => !backendish.includes(t));

  if (backendish.length && /\\textbf\{Backend:\}/i.test(out)) {
    out = out.replace(/(\\textbf\{Backend:\}[^\\\n]*)/i, `$1, ${backendish.join(', ')}`);
  } else if (backendish.length) {
    restOther.push(...backendish);
  }

  if (restOther.length) {
    const joinedOther = restOther.join(', ');
    if (/\\textbf\{JD Keywords:\}/i.test(out)) {
      out = out.replace(
        /\\textbf\{JD Keywords:\}[^\\\n]*/i,
        `\\textbf{JD Keywords:} ${joinedOther} `
      );
    } else if (/\\textbf\{(?:Cloud(?:\s*\\&\s*DevOps|\/DevOps)?|Tools|Frameworks):\}/i.test(out)) {
      out = out.replace(
        /(\\textbf\{(?:Cloud(?:\s*\\&\s*DevOps|\/DevOps)?|Tools|Frameworks):\}[^\\\n]*)/i,
        `$1, ${joinedOther}`
      );
    } else if (/\\section\{\\textbf\{(?:Technical Skills|Skills)\}\}/i.test(out)) {
      const line = `\\textbf{JD Keywords:} ${joinedOther} \\\\`;
      out = out.replace(
        /(\\section\{\\textbf\{(?:Technical Skills|Skills)\}\}\s*(?:\\vspace\{[^}]+\})?\s*)/i,
        `$1${line}\n`
      );
    }
  }

  return out;
}

/** Short Experience bullet fragments keyed by normalized skill. */
const EXPERIENCE_EVIDENCE: Record<string, string> = {
  'c#':
    'Built Windows screen-casting tooling in \\textbf{C\\#} (MirrorMate / Miracast) with real-time media and networking.',
  'rest apis':
    'Designed and shipped \\textbf{REST APIs} with OpenAPI/Swagger docs, auth, and client integrations.',
  rest: 'Designed and shipped \\textbf{REST APIs} with OpenAPI/Swagger docs, auth, and client integrations.',
  java: 'Delivered backend services in \\textbf{Java} with Spring Boot patterns and production monitoring.',
  python: 'Automated operational workflows in \\textbf{Python} with tests and observability hooks.',
  'node.js': 'Built Node.js services and APIs supporting production web and mobile clients.',
  react: 'Shipped \\textbf{React} UI modules with accessible, responsive patterns for campus users.',
  typescript: 'Wrote type-safe \\textbf{TypeScript} services and shared client/server contracts.',
  javascript: 'Delivered front-end features in \\textbf{JavaScript} with reusable component patterns.',
  'spring boot': 'Implemented \\textbf{Spring Boot} services with REST endpoints and persistence.',
  'ci/cd': 'Owned \\textbf{CI/CD} pipelines with automated tests, build gates, and safe releases.',
  aws: 'Operated workloads on \\textbf{AWS} with infrastructure-as-code and CloudWatch monitoring.',
  postgresql: 'Modeled and queried \\textbf{PostgreSQL} schemas with indexing for API latency.',
  mysql: 'Tuned \\textbf{MySQL} queries and schemas for transactional web workloads.',
  mongodb: 'Designed \\textbf{MongoDB} document models for flexible product catalogs.',
  redis: 'Used \\textbf{Redis} caching and queues to cut hot-path latency.',
  sql: 'Wrote efficient \\textbf{SQL} for reporting and API-backed data access.',
};

function experienceEvidenceFragment(token: string): string {
  const key = normalizeSkill(token);
  if (EXPERIENCE_EVIDENCE[key]) return EXPERIENCE_EVIDENCE[key];
  const safe = latexSafeToken(token);
  return `Applied \\textbf{${safe}} in production services with measurable reliability and maintainability.`;
}

function injectIntoExperienceBullets(latex: string, tokens: string[]): string {
  const expMatch = latex.match(
    /(\\section\{\\textbf\{Work Experience\}\}[\s\S]*?)(?=\\section\{\\textbf\{Skills\}\}|\\section\{\\textbf\{Key Projects\}\}|\\end\{document\})/i
  );
  if (!expMatch) return latex;

  const expBody = expMatch[1];
  const expPlain = latexToPlain(expBody);
  const need = tokens.filter((t) => !keywordCovered(expPlain, t));
  if (!need.length) return latex;

  let body = expBody;
  const csharp = need.filter((t) => normalizeSkill(t) === 'c#');
  const rest = need.filter((t) => /rest/i.test(t));
  const other = need.filter((t) => normalizeSkill(t) !== 'c#' && !/rest/i.test(t));

  // Prefer Infobell block for C# (MirrorMate); ASI for REST APIs; Infobell for leftovers.
  for (const t of csharp) {
    body = prependEvidenceToEmployerBlock(body, 'Infobell', experienceEvidenceFragment(t));
  }
  for (const t of rest) {
    body = prependEvidenceToEmployerBlock(body, 'Associated Students|ASI|CSULB', experienceEvidenceFragment(t));
  }
  for (const t of other.slice(0, 4)) {
    body = prependEvidenceToEmployerBlock(body, 'Infobell', experienceEvidenceFragment(t));
  }

  return latex.replace(expMatch[1], body);
}

/**
 * Insert a new \\item at the start of the first itemize under a matching employer header.
 */
function prependEvidenceToEmployerBlock(expBody: string, employerRe: string, fragment: string): string {
  const item = `  \\item ${fragment}`;
  const re = new RegExp(
    `((?:\\\\textbf\{[^}]+\}[\\s\\S]{0,200}?(?:${employerRe})[\\s\\S]{0,120}?)\\\\begin\{itemize\}[^\\n]*\\n)`,
    'i'
  );
  if (re.test(expBody)) {
    return expBody.replace(re, `$1${item}\n`);
  }
  // Fallback: first itemize in Work Experience
  return expBody.replace(/(\\begin\{itemize\}[^\n]*\n)/i, `$1${item}\n`);
}
