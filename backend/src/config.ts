import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const backendRoot = path.resolve(__dirname, '..');

export const config = {
  port: Number(process.env.PORT) || 5001,
  /** Local-only by default because the API controls browsers and destructive job actions. */
  host: process.env.HOST || '127.0.0.1',
  mongoUri: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/job-tracker',
  uploadsDir: path.join(backendRoot, 'uploads'),

  chatgpt: {
    url:
      process.env.CHATGPT_URL ||
      'https://chatgpt.com/g/g-p-6a26fbe080bc8191b6dfecd57dc7054e/c/6a26fc87-0070-8330-ba08-527437041530',
    profileDirectory: process.env.GREEN_PROFILE_DIR || 'Profile 16',
    accountEmail: process.env.GREEN_ACCOUNT_EMAIL || 'karthikkovik@gmail.com',
    debugPort: Number(process.env.GREEN_DEBUG_PORT) || 9224,
    userDataDir: path.join(backendRoot, '.green_chrome_automation'),
    headless: process.env.GREEN_HEADLESS === 'true',
    responseWaitMs: Number(process.env.CHATGPT_WAIT_MS) || 180000,
    /** URL param for Instant tier (not Pro/Thinking). */
    model: process.env.CHATGPT_MODEL || 'instant',
  },

  claude: {
    url: process.env.CLAUDE_URL || 'https://claude.ai/chats',
    profileDirectory: process.env.GREEN_PROFILE_DIR || 'Profile 16',
    debugPort: Number(process.env.GREEN_DEBUG_PORT) || 9224,
    userDataDir: path.join(backendRoot, '.green_chrome_automation'),
    headless: process.env.GREEN_HEADLESS === 'true',
    responseWaitMs: Number(process.env.CLAUDE_WAIT_MS) || 180000,
  },

  ollama: {
    apiUrl: process.env.OLLAMA_API_URL || 'http://127.0.0.1:11434',
    /** Local free model when RESUME_PROVIDER=ollama (no cloud, no API key) */
    model: process.env.OLLAMA_MODEL || 'resumemaker',
    /**
     * How long to keep the model loaded in VRAM after each request (Ollama keep_alive).
     * Avoids reloading weights between resumes. Examples: "30m", "5m", "-1" (forever), "0" (unload).
     */
    keepAlive: process.env.OLLAMA_KEEP_ALIVE || '30m',
    /** Desktop sidebar chat title — default "Resumes" */
    chatName: process.env.OLLAMA_CHAT_NAME || 'Resumes',
    /** Optional fixed chat UUID; auto-read from Ollama db.sqlite if empty */
    chatId: process.env.OLLAMA_CHAT_ID || '',
    /** Ollama desktop UI port — 0 = auto-detect from lsof */
    desktopPort: Number(process.env.OLLAMA_DESKTOP_PORT) || 0,
    profileDirectory: process.env.GREEN_PROFILE_DIR || 'Profile 16',
    debugPort: Number(process.env.GREEN_DEBUG_PORT) || 9224,
    userDataDir: path.join(backendRoot, '.green_chrome_automation'),
    headless: process.env.GREEN_HEADLESS === 'true',
    responseWaitMs: Number(process.env.OLLAMA_WAIT_MS) || 900000,
    /** Prior messages from desktop "Resumes" chat (your rules) — JD is sent separately */
    historyMessages: Number(process.env.OLLAMA_HISTORY_MSGS) || 20,
  },

  /** After each new scraped job, queue tailored LaTeX resume generation automatically. */
  autoResume: {
    enabled: process.env.AUTO_RESUME_ENABLED !== 'false',
  },

  /** Built-in resume agent — claude-code | openrouter (OmniRoute/cloud) | ollama */
  resumeAgent: {
    provider: (process.env.RESUME_PROVIDER || 'ollama') as 'claude-code' | 'openrouter' | 'ollama',
    openRouter: {
      apiKey: process.env.OPENROUTER_API_KEY || '',
      baseUrl: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
      /** Free default — no OpenRouter credits required */
      model: process.env.OPENROUTER_MODEL || 'google/gemma-4-31b-it:free',
      siteUrl: process.env.OPENROUTER_SITE_URL || 'http://localhost:5173',
      appName: process.env.OPENROUTER_APP_NAME || 'ResumeMaker Job Tracker',
      maxTokens: Number(process.env.OPENROUTER_MAX_TOKENS) || 16384,
      temperature: Number(process.env.OPENROUTER_TEMPERATURE) || 0.4,
    },
    claudeCode: {
      /** Claude Code CLI binary (default: ~/.local/bin/claude) */
      binary: process.env.CLAUDE_CODE_BINARY || '',
      /** sonnet | opus | haiku or full model id */
      model: process.env.CLAUDE_CODE_MODEL || 'sonnet',
      timeoutMs: Number(process.env.CLAUDE_CODE_TIMEOUT_MS) || 900000,
      maxTurns: Number(process.env.CLAUDE_CODE_MAX_TURNS) || 1,
    },
  },

  linkedin: {
    profileDirectory: process.env.ORANGE_PROFILE_DIR || 'Profile 26',
    accountEmail: process.env.ORANGE_ACCOUNT_EMAIL || 'karthikkovik@gmail.com',
    debugPort: Number(process.env.ORANGE_DEBUG_PORT) || 9333,
    userDataDir: path.join(backendRoot, '.orange_chrome_automation'),
    headless: process.env.ORANGE_HEADLESS === 'false' ? false : process.env.ORANGE_HEADLESS === 'true',
    /** Legacy internship searches (deprioritized — primary mode is full-time). */
    internshipSearches: (
      process.env.LINKEDIN_INTERN_SEARCH_URLS ||
      [
        'https://www.linkedin.com/jobs/search/?keywords=software%20engineering%20intern&f_E=1&geoId=103644278&location=United%20States&sortBy=DD',
      ].join('|')
    )
      .split('|')
      .map((u) => u.trim())
      .filter(Boolean),
    /** Full-time / new-grad SWE searches (primary). f_E=2,3 = Entry + Associate. */
    fullTimeSearches: (
      process.env.LINKEDIN_FT_SEARCH_URLS ||
      [
        'https://www.linkedin.com/jobs/search/?keywords=Software%20Engineer%20New%20Grad&f_E=2%2C3&geoId=103644278&location=United%20States&sortBy=DD',
        'https://www.linkedin.com/jobs/search/?keywords=Software%20Development%20Engineer%20I&f_E=2%2C3&geoId=103644278&location=United%20States&sortBy=DD',
        'https://www.linkedin.com/jobs/search/?keywords=Full%20Stack%20Software%20Engineer&f_E=2%2C3&geoId=103644278&location=United%20States&sortBy=DD',
        'https://www.linkedin.com/jobs/search/?keywords=Entry%20Level%20Software%20Engineer&f_E=2%2C3&geoId=103644278&location=United%20States&sortBy=DD',
        'https://www.linkedin.com/jobs/search/?keywords=Backend%20Software%20Engineer%20JavaScript%20Node.js&f_E=2%2C3&geoId=103644278&location=United%20States&sortBy=DD',
        'https://www.linkedin.com/jobs/search/?keywords=Frontend%20Engineer%20React&f_E=2%2C3&geoId=103644278&location=United%20States&sortBy=DD',
        'https://www.linkedin.com/jobs/search/?keywords=React%20Native%20Software%20Engineer&f_E=2%2C3&geoId=103644278&location=United%20States&sortBy=DD',
        'https://www.linkedin.com/jobs/search/?keywords=Full%20Time%20Software%20Engineer%202027&f_E=2%2C3&geoId=103644278&location=United%20States&sortBy=DD',
        'https://www.linkedin.com/jobs/search/?keywords=New%20Grad%20SWE&f_E=2%2C3&geoId=103644278&location=United%20States&sortBy=DD',
        'https://www.linkedin.com/jobs/search/?keywords=Software%20Engineer%20University%20Graduate&f_E=2%2C3&geoId=103644278&location=United%20States&sortBy=DD',
      ].join('|')
    )
      .split('|')
      .map((u) => u.trim())
      .filter(Boolean),
    maxJobsPerSearch: Number(process.env.SCRAPE_MAX_JOBS) || 50,
    /** 0 = no cap — scrape every match in the run, then stop. */
    scrapeTargetTotal: Number(process.env.SCRAPE_TARGET_TOTAL) || 0,
  },

  jobright: {
    searchUrl:
      process.env.JOBRIGHT_SEARCH_URL ||
      'https://jobright.ai/jobs/search?value=New+Grad+Software+Engineer&country=US&isH1BOnly=false&excludeStaffingAgency=false&excludeSecurityClearance=false&excludeUsCitizen=false&refresh=true&position=0&sortCondition=1&searchType=job_title',
    searches: (
      process.env.JOBRIGHT_SEARCH_URLS ||
      [
        'https://jobright.ai/jobs/search?value=Software+Engineering+Intern&country=US&isH1BOnly=false&excludeStaffingAgency=false&excludeSecurityClearance=false&excludeUsCitizen=false&refresh=true&position=0&sortCondition=1&searchType=job_title',
      ].join('|')
    )
      .split('|')
      .map((u) => u.trim())
      .filter(Boolean),
    fullTimeSearchUrl:
      process.env.JOBRIGHT_FT_SEARCH_URL ||
      'https://jobright.ai/jobs/search?value=New+Grad+Software+Engineer&country=US&isH1BOnly=false&excludeStaffingAgency=false&excludeSecurityClearance=false&excludeUsCitizen=false&refresh=true&position=0&sortCondition=1&searchType=job_title',
    fullTimeSearches: (
      process.env.JOBRIGHT_FT_SEARCH_URLS ||
      [
        'https://jobright.ai/jobs/search?value=New+Grad+Software+Engineer&country=US&isH1BOnly=false&excludeStaffingAgency=false&excludeSecurityClearance=false&excludeUsCitizen=false&refresh=true&position=0&sortCondition=1&searchType=job_title',
        'https://jobright.ai/jobs/search?value=Entry+Level+Software+Engineer&country=US&isH1BOnly=false&excludeStaffingAgency=false&excludeSecurityClearance=false&excludeUsCitizen=false&refresh=true&position=0&sortCondition=1&searchType=job_title',
        'https://jobright.ai/jobs/search?value=Software+Engineer+New+Graduate&country=US&isH1BOnly=false&excludeStaffingAgency=false&excludeSecurityClearance=false&excludeUsCitizen=false&refresh=true&position=0&sortCondition=1&searchType=job_title',
        'https://jobright.ai/jobs/search?value=Full+Stack+Engineer+Full+Time&country=US&isH1BOnly=false&excludeStaffingAgency=false&excludeSecurityClearance=false&excludeUsCitizen=false&refresh=true&position=0&sortCondition=1&searchType=job_title',
        'https://jobright.ai/jobs/search?value=Software+Developer+Entry+Level&country=US&isH1BOnly=false&excludeStaffingAgency=false&excludeSecurityClearance=false&excludeUsCitizen=false&refresh=true&position=0&sortCondition=1&searchType=job_title',
        'https://jobright.ai/jobs/search?value=Backend+Software+Engineer&country=US&isH1BOnly=false&excludeStaffingAgency=false&excludeSecurityClearance=false&excludeUsCitizen=false&refresh=true&position=0&sortCondition=1&searchType=job_title',
        'https://jobright.ai/jobs/search?value=Software+Engineer+University+Graduate&country=US&isH1BOnly=false&excludeStaffingAgency=false&excludeSecurityClearance=false&excludeUsCitizen=false&refresh=true&position=0&sortCondition=1&searchType=job_title',
      ].join('|')
    )
      .split('|')
      .map((u) => u.trim())
      .filter(Boolean),
    maxJobsPerSearch: Number(process.env.JOBRIGHT_MAX_JOBS) || 50,
  },

  indeed: {
    searches: (
      process.env.INDEED_SEARCH_URLS ||
      [
        'https://www.indeed.com/jobs?q=software+engineering+intern&l=United+States&sort=date',
      ].join('|')
    )
      .split('|')
      .map((u) => u.trim())
      .filter(Boolean),
    fullTimeSearches: (
      process.env.INDEED_FT_SEARCH_URLS ||
      [
        'https://www.indeed.com/jobs?q=Entry+Level+Software+Engineer&l=United+States&sort=date',
        'https://www.indeed.com/jobs?q=Software+Engineer+New+Graduate&l=United+States&sort=date',
        'https://www.indeed.com/jobs?q=Full+Stack+Engineer+Full+Time&l=United+States&sort=date',
        'https://www.indeed.com/jobs?q=Software+Developer+Entry+Level&l=United+States&sort=date',
        'https://www.indeed.com/jobs?q=Backend+Software+Engineer&l=United+States&sort=date',
        'https://www.indeed.com/jobs?q=New+Grad+Software+Engineer+2027&l=United+States&sort=date',
      ].join('|')
    )
      .split('|')
      .map((u) => u.trim())
      .filter(Boolean),
    maxJobsPerSearch: Number(process.env.INDEED_MAX_JOBS) || 50,
  },

  emailjs: {
    enabled: process.env.EMAILJS_ENABLED !== 'false',
    serviceId: process.env.EMAILJS_SERVICE_ID || 'service_kez1h7i',
    templateId: process.env.EMAILJS_TEMPLATE_ID || 'template_uxz9xbf',
    publicKey: process.env.EMAILJS_PUBLIC_KEY || 'jz9yQYm-QSbfpTR9D',
    privateKey: process.env.EMAILJS_PRIVATE_KEY || '',
    fromName: process.env.EMAILJS_FROM_NAME || 'AI Job Tracker',
    toName: process.env.EMAILJS_TO_NAME || 'Karthik Kovi',
    fromEmail: process.env.EMAILJS_FROM_EMAIL || 'karthikkovik@gmail.com',
    toEmail: process.env.EMAILJS_TO_EMAIL || 'karthikkovik@gmail.com',
  },

  approval: {
    pollIntervalMs: Number(process.env.APPROVAL_POLL_MS) || 3000,
    timeoutMs: Number(process.env.APPROVAL_TIMEOUT_MS) || 30 * 60 * 1000,
  },

  pipeline: {
    /** Max NEW jobs for a full pipeline run across ALL sources combined (shared quota). */
    perSourceCap: Number(process.env.PIPELINE_PER_SOURCE_CAP) || 50,
  },

  /** Pipeline “career portals” = Google Jobs search (US), not company career sites. */
  careerPortal: {
    maxJobsPerSearch: Number(process.env.GOOGLE_JOBS_MAX_PER_SEARCH) || 50,
    searches: (
      process.env.GOOGLE_JOBS_SEARCH_URLS ||
      [
        'https://www.google.com/search?q=new+grad+software+engineer+2027&udm=8&hl=en&gl=us',
        'https://www.google.com/search?q=entry+level+software+engineer&udm=8&hl=en&gl=us',
        'https://www.google.com/search?q=software+engineer+university+graduate&udm=8&hl=en&gl=us',
        'https://www.google.com/search?q=full+stack+software+engineer+full+time&udm=8&hl=en&gl=us',
        'https://www.google.com/search?q=backend+software+engineer+entry+level&udm=8&hl=en&gl=us',
        'https://www.google.com/search?ibp=htl;jobs&q=new+grad+software+engineer&hl=en&gl=us',
      ].join('|')
    )
      .split('|')
      .map((u) => u.trim())
      .filter(Boolean),
  },

  /**
   * Direct ATS board scraping — free, no browser automation.
   * Greenhouse: slug = the token in boards.greenhouse.io/{slug}
   * Lever: slug = the token in jobs.lever.co/{slug}
   * Override/extend via ATS_GREENHOUSE_BOARDS / ATS_LEVER_BOARDS as "slug:Company Name" pairs, comma or pipe separated.
   */
  ats: {
    greenhouseBoards: parseBoardList(process.env.ATS_GREENHOUSE_BOARDS, [
      ['stripe', 'Stripe'],
      ['airbnb', 'Airbnb'],
      ['robinhood', 'Robinhood'],
      ['coinbase', 'Coinbase'],
      ['discord', 'Discord'],
      ['figma', 'Figma'],
      ['brex', 'Brex'],
      ['gusto', 'Gusto'],
      ['instacart', 'Instacart'],
      ['flexport', 'Flexport'],
      ['affirm', 'Affirm'],
      ['samsara', 'Samsara'],
      ['gitlab', 'GitLab'],
      ['reddit', 'Reddit'],
      ['squarespace', 'Squarespace'],
      ['anthropic', 'Anthropic'],
      ['databricks', 'Databricks'],
      ['asana', 'Asana'],
      ['webflow', 'Webflow'],
      ['toast', 'Toast'],
      ['dropbox', 'Dropbox'],
    ]),
    leverBoards: parseBoardList(process.env.ATS_LEVER_BOARDS, [
      ['palantir', 'Palantir'],
      ['wealthfront', 'Wealthfront'],
    ]),
  },

  scheduler: {
    /** Opt-in only — default off so manual "Scrape Jobright" is not hijacked by full pipeline. */
    enabled: process.env.SCHEDULER_ENABLED === 'true',
    timezone: process.env.SCHEDULER_TIMEZONE || 'America/Los_Angeles',
    /** How often to check for window changes (ms). Scrape runs once per window. */
    checkIntervalMs: Number(process.env.SCHEDULER_CHECK_MS) || 60 * 1000,
    /** 0 = scrape all full-time / new-grad matches from career portals overnight */
    nightScrapeCap: Number(process.env.SCHEDULER_NIGHT_CAP) || 0,
    priorityScrapeCap: Number(process.env.SCHEDULER_PRIORITY_CAP) || 0,
  },

  apply: {
    overwritePreviousAnswers: process.env.APPLY_OVERWRITE_ANSWERS === 'true',
    useAiForQuestions: process.env.APPLY_USE_AI !== 'false',
  },

  skipRules: {
    badWords: parseEnvList(process.env.SKIP_BAD_WORDS, [
      // Citizenship handled by isIneligibleForMastersF1 (avoid bare "US Citizen"
      // substring matching "citizenship not required"). Keep no-sponsorship jobs.
      'No C2C',
      'No Corp2Corp',
      'security clearance',
      'polygraph',
      'Embedded Programming',
      'FPGA',
      'CNC',
      // Full-time targeting: skip senior/staff titles when they appear as hard filters in JD text.
      // Intern/Senior title filtering is also handled in eligibility.ts.
    ]),
    aboutCompanyBadWords: parseEnvList(process.env.SKIP_COMPANY_BAD_WORDS, ['Crossover', 'Staffing']),
    aboutCompanyGoodWords: parseEnvList(process.env.SKIP_COMPANY_GOOD_WORDS, []),
    companyBlacklist: parseEnvList(process.env.SKIP_COMPANY_BLACKLIST, []),
    securityClearance: process.env.HAS_SECURITY_CLEARANCE === 'true',
    didMasters: process.env.DID_MASTERS !== 'false',
    /** Years on your resume — jobs above this + tolerance are skipped */
    currentExperience: Number(process.env.CURRENT_EXPERIENCE ?? 3),
    /** Extra headroom for fractional reqs (e.g. 3.2 years) and 3+ wording */
    experienceTolerance: Number(process.env.EXPERIENCE_TOLERANCE ?? 0.5),
  },
};

function parseEnvList(raw: string | undefined, defaults: string[]): string[] {
  if (!raw?.trim()) return defaults;
  return raw
    .split(/[|,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

interface AtsBoard {
  slug: string;
  company: string;
}

/** Parses "slug:Company Name" pairs (comma or pipe separated) or falls back to defaults. */
function parseBoardList(raw: string | undefined, defaults: [string, string][]): AtsBoard[] {
  if (!raw?.trim()) return defaults.map(([slug, company]) => ({ slug, company }));
  return raw
    .split(/[|,]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const [slug, company] = entry.split(':').map((s) => s.trim());
      return { slug, company: company || slug };
    })
    .filter((b) => Boolean(b.slug));
}
