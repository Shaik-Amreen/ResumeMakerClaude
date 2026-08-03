/**
 * Extract required-ish keywords from a JD and score how well LaTeX covers them.
 * Goal: surface missing skills so the resume agent can revise to ~100% coverage.
 * Only real tech tokens — never HTML tags, prose phrases, or UI chrome.
 */

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
]);

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

/** Reject HTML residue / prose / UI chrome that must never land on the resume. */
export function isJunkSkillToken(token: string): boolean {
  const t = token.trim().replace(/[.,;:]+$/g, '');
  if (t.length < 2 || t.length > 36) return true;
  if (/[.!?]/.test(t)) return true;
  if ((t.match(/\s+/g) || []).length >= 3) return true; // 4+ words = prose
  if (/<\/?[a-z]|^\s*p\b|&nbsp;|nbsp|strong|div|span|font-size|FeedBlock|Themeable/i.test(t)) {
    return true;
  }
  if (
    /\b(knowledge|abilities|proficiency|familiarity|diplomacy|judgment|escalat|identify|troubleshoot and resolve|sound judgment|preferred|required|plus|concepts|build|design|ship|bring|demonstrated|ability|physical|world|you'll|internship|production systems|what you|prior|collaborative|firmware|batteries|ercot|participate|shadow|partner)\b/i.test(
      t
    )
  ) {
    return true;
  }
  if (STOP.has(normalizeSkill(t))) return true;
  // Pure prose phrases (no tech markers)
  if (/^[a-z][a-z\s]+$/i.test(t) && !/[+#/\d]/.test(t) && t.split(/\s+/).length >= 2) {
    if (!/\b(api|rest|sql|oop|ood|ci|cd|iot|tcp|udp|mvc|aws|gcp|net)\b/i.test(t)) return true;
  }
  return false;
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
  const variants = [
    key,
    key.replace(/\./g, ''),
    key.replace(/\s+/g, ''),
    key.replace(/-/g, ' '),
  ];
  return variants.some((v) => v.length >= 2 && plain.includes(v));
}

function latexToPlain(latex: string): string {
  return latex
    .replace(/%.*$/gm, ' ')
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

  const matchedSet = new Set(
    [...llm.matched, ...regex.matched].map((s) => s.trim()).filter(Boolean)
  );
  const missingFromLlm = llm.missing.filter((s) => !matchedSet.has(s));
  // Also surface regex-missing that LLM forgot to list
  for (const m of regex.missing) {
    if (![...matchedSet].some((x) => x.toLowerCase() === m.toLowerCase())) {
      if (!missingFromLlm.some((x) => x.toLowerCase() === m.toLowerCase())) {
        missingFromLlm.push(m);
      }
    }
  }

  const keywords = [
    ...new Set([...(llm.jdSkills.length ? llm.jdSkills : regex.keywords), ...matchedSet, ...missingFromLlm]),
  ].slice(0, 40);

  const matched = [...matchedSet];
  const missing = missingFromLlm;
  const score =
    keywords.length === 0
      ? 100
      : Math.round((matched.length / Math.max(matched.length + missing.length, 1)) * 100);

  const llmGaps = (llm.skillGaps || []).map((s) => s.trim()).filter(Boolean);
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

/** Count live project URLs in Featured Projects (excludes pubs/certs/linkedin). */
export function countLinkedFeaturedProjects(latex: string): number {
  const projects =
    latex.match(
      /\\section\{\\textbf\{Featured Projects\}\}([\s\S]*?)(?=\\section\{\\textbf\{Publications|\\section\{\\textbf\{Certifications|\\end\{document\})/i
    )?.[1] || '';
  const known = [
    'nativenest.in',
    'origemindia.com',
    'b4igo.com',
    'adp-scraper-vercel.vercel.app',
    'upturn.io',
    'arikya.com',
    'apps.apple.com',
    'play.google.com',
  ];
  const hrefs = [...projects.matchAll(/\\href\{(https?:\/\/[^}]+)\}/gi)].map((m) =>
    m[1].toLowerCase()
  );
  // Count unique project domains (app-store links for same product still count as one project if paired)
  const titles = [
    ...projects.matchAll(/\\href\{https?:\/\/[^}]+\}\{\\uline\{\\textbf\{([^}]+)/gi),
  ];
  if (titles.length >= 3) return titles.length;
  const linked = hrefs.filter((u) => known.some((k) => u.includes(k)));
  // Dedupe by hostname
  const hosts = new Set(
    linked.map((u) => {
      try {
        return new URL(u).hostname.replace(/^www\./, '');
      } catch {
        return u;
      }
    })
  );
  // App stores alone don't count without a primary project domain
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
 * Deterministically fold missing JD keywords into Technical Skills.
 * Only known tech tokens — never HTML/prose junk.
 * Never append to Languages (that line is language-only).
 */
export function injectMissingJdKeywords(latex: string, missing: string[]): string {
  const plain = latexToPlain(latex);
  const languageNames = new Set(
    ['python', 'java', 'javascript', 'typescript', 'sql', 'go', 'c++', 'c#', 'php', 'rust', 'kotlin', 'swift', 'html', 'css', 'bash', 'perl', 'shell', 'r', 'scala'].map(
      (s) => s.toLowerCase()
    )
  );
  const allowed = new Set(TECH_PATTERNS.map((t) => normalizeSkill(t.display)));
  const tokens = missing
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && t.length <= 36)
    .filter((t) => !isJunkSkillToken(t))
    .filter((t) => !/[.!?]/.test(t) && (t.match(/\s+/g) || []).length < 3)
    .filter(
      (t) =>
        allowed.has(normalizeSkill(t)) ||
        TECH_PATTERNS.some((p) => {
          p.re.lastIndex = 0;
          return p.re.test(t);
        })
    )
    .filter((t) => !/^c\+\+\s*\d+/i.test(t))
    .filter((t) => !keywordCovered(plain, t))
    .map(latexSafeToken)
    .filter(Boolean)
    .slice(0, 10);
  if (!tokens.length) return latex;

  const langTokens = tokens.filter((t) => languageNames.has(normalizeSkill(t).replace(/\(es6\+?\)/, '').trim()));
  const otherTokens = tokens.filter((t) => !languageNames.has(normalizeSkill(t).replace(/\(es6\+?\)/, '').trim()));

  let out = latex;
  if (langTokens.length && /\\textbf\{Languages:\}/i.test(out)) {
    const joined = langTokens.join(', ');
    out = out.replace(/(\\textbf\{Languages:\}[^\\\n]*)/i, `$1, ${joined}`);
  }

  const joinedOther = otherTokens.join(', ');
  if (joinedOther) {
    if (/\\textbf\{JD Keywords:\}/i.test(out)) {
      out = out.replace(
        /\\textbf\{JD Keywords:\}[^\\\n]*/i,
        `\\textbf{JD Keywords:} ${joinedOther} `
      );
    } else if (/\\textbf\{(?:Cloud(?:\/DevOps)?|Tools|Frameworks):\}/i.test(out)) {
      out = out.replace(
        /(\\textbf\{(?:Cloud(?:\/DevOps)?|Tools|Frameworks):\}[^\\\n]*)/i,
        `$1, ${joinedOther}`
      );
    } else if (/\\section\{\\textbf\{Technical Skills\}\}/i.test(out)) {
      const line = `\\textbf{JD Keywords:} ${joinedOther} \\\\`;
      out = out.replace(
        /(\\section\{\\textbf\{Technical Skills\}\}\s*(?:\\vspace\{[^}]+\})?\s*)/i,
        `$1${line}\n`
      );
    }
  }

  return out;
}
