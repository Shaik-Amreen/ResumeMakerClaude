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
    accountEmail: process.env.GREEN_ACCOUNT_EMAIL || 'amreenshaikkousar@gmail.com',
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
    accountEmail: process.env.ORANGE_ACCOUNT_EMAIL || 'shaikamreenkousar@gmail.com',
    debugPort: Number(process.env.ORANGE_DEBUG_PORT) || 9333,
    userDataDir: path.join(backendRoot, '.orange_chrome_automation'),
    headless: process.env.ORANGE_HEADLESS === 'false' ? false : process.env.ORANGE_HEADLESS === 'true',
    /** Summer 2027 software internship searches only (full-time paused until this is solid). */
    internshipSearches: (
      process.env.LINKEDIN_INTERN_SEARCH_URLS ||
      [
        // geoId=103644278 = United States
        'https://www.linkedin.com/jobs/search/?keywords=summer%202027%20software%20engineering%20internship&f_E=1&geoId=103644278&location=United%20States&sortBy=DD',
        'https://www.linkedin.com/jobs/search/?keywords=summer%202027%20internship%20software%20developer&f_E=1&geoId=103644278&location=United%20States&sortBy=DD',
        'https://www.linkedin.com/jobs/search/?keywords=summer%202027%20computer%20science%20internship&f_E=1&geoId=103644278&location=United%20States&sortBy=DD',
        'https://www.linkedin.com/jobs/search/?keywords=summer%202027%20SWE%20intern&f_E=1&geoId=103644278&location=United%20States&sortBy=DD',
        'https://www.linkedin.com/jobs/search/?keywords=summer%202027%20full%20stack%20internship&f_E=1&geoId=103644278&location=United%20States&sortBy=DD',
        'https://www.linkedin.com/jobs/search/?keywords=software%20engineering%20intern%20summer%202027&f_E=1&geoId=103644278&location=United%20States&sortBy=DD',
      ].join('|')
    )
      .split('|')
      .map((u) => u.trim())
      .filter(Boolean),
    fullTimeSearches: (
      process.env.LINKEDIN_FT_SEARCH_URLS ||
      [
        'https://www.linkedin.com/jobs/search/?keywords=new%20grad%20software%20engineer%202027&f_E=2%2C3&geoId=103644278&location=United%20States&sortBy=DD',
        'https://www.linkedin.com/jobs/search/?keywords=entry%20level%20software%20developer%202027&f_E=2%2C3&geoId=103644278&location=United%20States&sortBy=DD',
        'https://www.linkedin.com/jobs/search/?keywords=software%20engineer%201-3%20years%20experience&f_E=2%2C3&geoId=103644278&location=United%20States&sortBy=DD',
        'https://www.linkedin.com/jobs/search/?keywords=software%20engineer%203%20years%20experience&f_E=2%2C3&geoId=103644278&location=United%20States&sortBy=DD',
        'https://www.linkedin.com/jobs/search/?keywords=associate%20software%20engineer&f_E=2%2C3&geoId=103644278&location=United%20States&sortBy=DD',
        'https://www.linkedin.com/jobs/search/?keywords=new%20grad%20full%20stack%20developer%202027&f_E=2%2C3&geoId=103644278&location=United%20States&sortBy=DD',
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
      'https://jobright.ai/jobs/search?value=Summer+2027+Internship+Software&country=US&isH1BOnly=false&excludeStaffingAgency=false&excludeSecurityClearance=false&excludeUsCitizen=false&refresh=true&position=0&sortCondition=1&searchType=job_title&jobTaxonomyList=%5B%7B%22taxonomyId%22%3A%2200-00-00%22%2C%22title%22%3A%22Summer+2027+Internship+Software%22%7D%5D',
    searches: (
      process.env.JOBRIGHT_SEARCH_URLS ||
      [
        // sortCondition 1 = match, 0 / 2 = alternate order for fresh batches
        'https://jobright.ai/jobs/search?value=Summer+2027+Internship+Software&country=US&isH1BOnly=false&excludeStaffingAgency=false&excludeSecurityClearance=false&excludeUsCitizen=false&refresh=true&position=0&sortCondition=1&searchType=job_title',
        'https://jobright.ai/jobs/search?value=Summer+2027+Internship+Software&country=US&isH1BOnly=false&excludeStaffingAgency=false&excludeSecurityClearance=false&excludeUsCitizen=false&refresh=true&position=0&sortCondition=0&searchType=job_title',
        'https://jobright.ai/jobs/search?value=Summer+2027+Internship+Software&country=US&isH1BOnly=false&excludeStaffingAgency=false&excludeSecurityClearance=false&excludeUsCitizen=false&refresh=true&position=0&sortCondition=2&searchType=job_title',
        'https://jobright.ai/jobs/search?value=Software+Engineering+Intern+Summer+2027&country=US&isH1BOnly=false&excludeStaffingAgency=false&excludeSecurityClearance=false&excludeUsCitizen=false&refresh=true&position=0&sortCondition=1&searchType=job_title',
        'https://jobright.ai/jobs/search?value=Software+Developer+Intern+Summer+2027&country=US&isH1BOnly=false&excludeStaffingAgency=false&excludeSecurityClearance=false&excludeUsCitizen=false&refresh=true&position=0&sortCondition=2&searchType=job_title',
        'https://jobright.ai/jobs/search?value=SWE+Intern+2027&country=US&isH1BOnly=false&excludeStaffingAgency=false&excludeSecurityClearance=false&excludeUsCitizen=false&refresh=true&position=0&sortCondition=1&searchType=job_title',
        'https://jobright.ai/jobs/search?value=Full+Stack+Intern+Summer+2027&country=US&isH1BOnly=false&excludeStaffingAgency=false&excludeSecurityClearance=false&excludeUsCitizen=false&refresh=true&position=0&sortCondition=1&searchType=job_title',
        'https://jobright.ai/jobs/search?value=Backend+Intern+Summer+2027&country=US&isH1BOnly=false&excludeStaffingAgency=false&excludeSecurityClearance=false&excludeUsCitizen=false&refresh=true&position=0&sortCondition=1&searchType=job_title',
        'https://jobright.ai/jobs/search?value=Frontend+Intern+Summer+2027&country=US&isH1BOnly=false&excludeStaffingAgency=false&excludeSecurityClearance=false&excludeUsCitizen=false&refresh=true&position=0&sortCondition=1&searchType=job_title',
        'https://jobright.ai/jobs/search?value=Platform+Engineering+Intern+2027&country=US&isH1BOnly=false&excludeStaffingAgency=false&excludeSecurityClearance=false&excludeUsCitizen=false&refresh=true&position=0&sortCondition=1&searchType=job_title',
        'https://jobright.ai/jobs/search?value=Mobile+Intern+Summer+2027&country=US&isH1BOnly=false&excludeStaffingAgency=false&excludeSecurityClearance=false&excludeUsCitizen=false&refresh=true&position=0&sortCondition=1&searchType=job_title',
        'https://jobright.ai/jobs/search?value=Cloud+Intern+Summer+2027&country=US&isH1BOnly=false&excludeStaffingAgency=false&excludeSecurityClearance=false&excludeUsCitizen=false&refresh=true&position=0&sortCondition=1&searchType=job_title',
        'https://jobright.ai/jobs/search?value=Java+Intern+Summer+2027&country=US&isH1BOnly=false&excludeStaffingAgency=false&excludeSecurityClearance=false&excludeUsCitizen=false&refresh=true&position=0&sortCondition=1&searchType=job_title',
        'https://jobright.ai/jobs/search?value=Python+Intern+Summer+2027&country=US&isH1BOnly=false&excludeStaffingAgency=false&excludeSecurityClearance=false&excludeUsCitizen=false&refresh=true&position=0&sortCondition=1&searchType=job_title',
        'https://jobright.ai/jobs/search?value=Computer+Science+Intern+Summer+2027&country=US&isH1BOnly=false&excludeStaffingAgency=false&excludeSecurityClearance=false&excludeUsCitizen=false&refresh=true&position=0&sortCondition=2&searchType=job_title',
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
        'https://jobright.ai/jobs/search?value=Entry+Level+Software+Developer&country=US&isH1BOnly=false&excludeStaffingAgency=false&excludeSecurityClearance=false&excludeUsCitizen=false&refresh=true&position=0&sortCondition=1&searchType=job_title',
        'https://jobright.ai/jobs/search?value=Software+Engineer+3+Years+Experience&country=US&isH1BOnly=false&excludeStaffingAgency=false&excludeSecurityClearance=false&excludeUsCitizen=false&refresh=true&position=0&sortCondition=1&searchType=job_title',
        'https://jobright.ai/jobs/search?value=1-3+Years+Software+Engineer&country=US&isH1BOnly=false&excludeStaffingAgency=false&excludeSecurityClearance=false&excludeUsCitizen=false&refresh=true&position=0&sortCondition=1&searchType=job_title',
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
        'https://www.indeed.com/jobs?q=summer+2027+software+engineering+intern&l=United+States&sort=date',
        'https://www.indeed.com/jobs?q=summer+2027+software+developer+intern&l=United+States&sort=date',
        'https://www.indeed.com/jobs?q=summer+2027+computer+science+internship&l=United+States&sort=date',
        'https://www.indeed.com/jobs?q=summer+2027+full+stack+intern&l=United+States&sort=date',
        'https://www.indeed.com/jobs?q=summer+2027+SWE+intern&l=United+States&sort=date',
      ].join('|')
    )
      .split('|')
      .map((u) => u.trim())
      .filter(Boolean),
    fullTimeSearches: (
      process.env.INDEED_FT_SEARCH_URLS ||
      [
        'https://www.indeed.com/jobs?q=new+grad+software+engineer+2027&l=United+States&sort=date',
        'https://www.indeed.com/jobs?q=entry+level+software+developer+2027&l=United+States&sort=date',
        'https://www.indeed.com/jobs?q=software+engineer+1-3+years+experience&l=United+States&sort=date',
        'https://www.indeed.com/jobs?q=software+engineer+3+years+experience&l=United+States&sort=date',
        'https://www.indeed.com/jobs?q=associate+software+engineer&l=United+States&sort=date',
        'https://www.indeed.com/jobs?q=new+grad+full+stack+developer&l=United+States&sort=date',
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
    toName: process.env.EMAILJS_TO_NAME || 'Shaik Amreen Kousar',
    fromEmail: process.env.EMAILJS_FROM_EMAIL || 'amreenshaik40@gmail.com',
    toEmail: process.env.EMAILJS_TO_EMAIL || 'amreenkousarshaik@gmail.com',
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
        'https://www.google.com/search?q=summer+2027+software+engineering+internship&udm=8&hl=en&gl=us',
        'https://www.google.com/search?q=software+engineering+intern+summer+2027&udm=8&hl=en&gl=us',
        'https://www.google.com/search?q=computer+science+internship+summer+2027&udm=8&hl=en&gl=us',
        'https://www.google.com/search?q=SWE+intern+summer+2027&udm=8&hl=en&gl=us',
        'https://www.google.com/search?q=full+stack+intern+summer+2027&udm=8&hl=en&gl=us',
        'https://www.google.com/search?ibp=htl;jobs&q=summer+2027+software+engineering+internship&hl=en&gl=us',
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
    /** 0 = scrape all Summer 2027 matches from career portals overnight */
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
