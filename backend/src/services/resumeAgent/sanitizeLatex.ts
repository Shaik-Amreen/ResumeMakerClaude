/**
 * Strip prose punctuation that must not appear in the resume PDF:
 * em dash (—) and en dash (–).
 * Keeps amazon.pdf design separators: \, \textbar \, and LaTeX date ranges `--`.
 * Also normalize C++ version numbers → plain "C++" (never C++20/C++23 on the resume).
 * Rebuild Languages / skill lines so JD prose can never pollute Technical Skills.
 */

/** Only these may appear after \textbf{Languages:} */
const LANGUAGE_TOKENS: Array<{ re: RegExp; display: string }> = [
  { re: /\bpython\b/i, display: 'Python' },
  { re: /\bjava\b(?!\s*script)/i, display: 'Java' },
  { re: /\bjavascript(?:\s*\(es6\+?\))?|\bes6\+?\b/i, display: 'JavaScript (ES6+)' },
  { re: /\btypescript\b/i, display: 'TypeScript' },
  { re: /\bsql\b/i, display: 'SQL' },
  { re: /\bgo(?:lang)?\b/i, display: 'Go' },
  { re: /\bc\+\+/i, display: 'C++' },
  { re: /\bc#|\bc\s*sharp\b/i, display: 'C#' },
  { re: /\bphp\b/i, display: 'PHP' },
  { re: /\brust\b/i, display: 'Rust' },
  { re: /\bkotlin\b/i, display: 'Kotlin' },
  { re: /\bswift\b/i, display: 'Swift' },
  { re: /\bhtml5?\b/i, display: 'HTML' },
  { re: /\bcss3?\b/i, display: 'CSS' },
  { re: /\bbash\b/i, display: 'Bash' },
  { re: /\bperl\b/i, display: 'Perl' },
  { re: /\bshell\b/i, display: 'Shell' },
  { re: /\br\b/i, display: 'R' },
  { re: /\bscala\b/i, display: 'Scala' },
];

const DEFAULT_LANGUAGES =
  'Python, Java, JavaScript (ES6+), TypeScript, SQL, Go, C++, PHP';

/** Tech tokens allowed on other skill lines (Frameworks / Tools / Cloud / etc.). */
const TECH_TOKEN_RE =
  /\b(?:React(?:\s*Native)?|Next\.?js|Node(?:\.?js)?|Express|Angular|Vue|Redux|Tailwind|Bootstrap|Docker|Kubernetes|K8s|CI\/CD|AWS|Azure|GCP|Terraform|MongoDB|PostgreSQL|MySQL|Redis|Kafka|RabbitMQ|GraphQL|REST(?:\s*APIs?)?|Flask|Django|FastAPI|Spring(?:\s*Boot)?|Nest\.?js|\.NET|Firebase|Git(?:Hub|Lab)?|Linux|Android|iOS|Jira|Postman|Swagger|Prometheus|Grafana|OpenTelemetry|Lambda|DynamoDB|S3|EC2|microservices|SOLID|OOD|OOP|Agile|Scrum|IoT|PLC)\b/gi;

export function sanitizeResumeLatex(latex: string): string {
  let out = latex
    .replace(/\u2014/g, ',') // —
    .replace(/\u2013/g, '-') // –
    .replace(/C\+\+\s*\(\s*C\+\+\d+(?:\s*\/\s*C\+\+\d+)*\s*\)/gi, 'C++')
    .replace(/C\+\+\d+/gi, 'C++')
    .replace(/<\/?[a-z][^>]*>/gi, ' ')
    .replace(/&nbsp;?/gi, ' ')
    .replace(/&amp;/gi, '\\&')
    .replace(/[ \t]+,/g, ',')
    .replace(/,(?!\d)(\S)/g, ', $1');

  // Bare "&" is a tabular alignment tab in LaTeX — always escape (keep existing \&).
  out = escapeLatexAmpersands(out);

  // Languages: allowlist rebuild — discard any JD prose / sentences / stray &.
  // Match through end of line (including \& and \\) — do NOT stop at backslash.
  out = out.replace(
    /\\textbf\{Languages:\}[^\n]*/gi,
    () => `\\textbf{Languages:} ${extractLanguages(out) || DEFAULT_LANGUAGES} \\\\`
  );

  // Other skill category lines: drop sentence-like junk tokens.
  out = out.replace(
    /(\\textbf\{(?:Frameworks|Tools|Cloud(?:\/DevOps)?|DevOps|Databases|Mobile|Testing|Other|JD Keywords|Full-Stack[^}]*|Backend[^}]*):\}[^\n]*)/gi,
    (line) => scrubGenericSkillLine(line)
  );

  // Escape again after rebuilds (labels like "Backend \& Services" stay intact).
  out = escapeLatexAmpersands(out);

  return out;
}

/** Turn every bare `&` into `\&` without double-escaping. */
export function escapeLatexAmpersands(latex: string): string {
  return latex.replace(/\\&/g, '\u0000').replace(/&/g, '\\&').replace(/\u0000/g, '\\&');
}

function extractLanguages(latex: string): string {
  const m = latex.match(/\\textbf\{Languages:\}([^\n]*)/i);
  const blob = (m?.[1] || '').replace(/\\&/g, '&').replace(/\\\\/g, ' ');
  const found: string[] = [];
  const seen = new Set<string>();
  for (const { re, display } of LANGUAGE_TOKENS) {
    re.lastIndex = 0;
    if (re.test(blob) && !seen.has(display.toLowerCase())) {
      // Prefer plain JavaScript if both match oddly
      if (display.startsWith('JavaScript') && seen.has('javascript (es6+)')) continue;
      seen.add(display.toLowerCase());
      found.push(display);
    }
  }
  return found.join(', ');
}

function scrubGenericSkillLine(line: string): string {
  const labelMatch = line.match(/^(\\textbf\{[^}]+:\})/);
  const label = labelMatch?.[1] || '';
  const rest = line.slice(label.length).replace(/\\\\/g, ' ').replace(/\\&/g, '&');

  // Keep short tech tokens / comma-separated skills; drop sentence fragments.
  const parts = rest
    .split(/[,;|]/)
    .map((p) => p.replace(/\\+$/g, '').trim())
    .filter(Boolean)
    .filter((p) => !isProseJunk(p))
    .filter((p) => p.length <= 40)
    .filter((p) => {
      TECH_TOKEN_RE.lastIndex = 0;
      return TECH_TOKEN_RE.test(p) || /^[A-Za-z0-9.+#/ \-]{2,28}$/.test(p);
    });

  const unique: string[] = [];
  const seen = new Set<string>();
  for (const p of parts) {
    const key = p.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(p);
  }

  if (!unique.length) {
    // Leave label only — better empty than polluted
    return `${label} \\\\`;
  }
  return `${label} ${unique.join(', ')} \\\\`;
}

function isProseJunk(token: string): boolean {
  const t = token.trim();
  if (!t) return true;
  if (/[.!?]/.test(t)) return true;
  if (/\b(?:build|design|ship|bring|demonstrated|ability|internship|physical|world|you'll|you will|what you|production systems|prior|collaborative|participate|shadow|partner|learnings|firmware|batteries|ercot)\b/i.test(t)) {
    return true;
  }
  if ((t.match(/\s+/g) || []).length >= 4) return true; // 5+ words
  if (/<\/?[a-z]|nbsp|strong|FeedBlock/i.test(t)) return true;
  return false;
}
