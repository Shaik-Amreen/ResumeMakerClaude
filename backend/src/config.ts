import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const backendRoot = path.resolve(__dirname, '..');

export const config = {
  port: Number(process.env.PORT) || 5001,
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
    /** Model for resume tailoring — must be pulled locally (ollama pull …) */
    model: process.env.OLLAMA_MODEL || 'minimax-m3:cloud',
    profileDirectory: process.env.GREEN_PROFILE_DIR || 'Profile 16',
    debugPort: Number(process.env.GREEN_DEBUG_PORT) || 9224,
    userDataDir: path.join(backendRoot, '.green_chrome_automation'),
    headless: process.env.GREEN_HEADLESS === 'true',
    responseWaitMs: Number(process.env.OLLAMA_WAIT_MS) || 300000,
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
        'https://www.linkedin.com/jobs/search/?keywords=summer%202027%20software%20engineering%20internship&f_E=1&sortBy=DD',
        'https://www.linkedin.com/jobs/search/?keywords=summer%202027%20internship%20software%20developer&f_E=1&sortBy=DD',
        'https://www.linkedin.com/jobs/search/?keywords=summer%202027%20computer%20science%20internship&f_E=1&sortBy=DD',
        'https://www.linkedin.com/jobs/search/?keywords=summer%202027%20SWE%20intern&f_E=1&sortBy=DD',
        'https://www.linkedin.com/jobs/search/?keywords=summer%202027%20full%20stack%20internship&f_E=1&sortBy=DD',
        'https://www.linkedin.com/jobs/search/?keywords=software%20engineering%20intern%20summer%202027&f_E=1&sortBy=DD',
      ].join('|')
    )
      .split('|')
      .map((u) => u.trim())
      .filter(Boolean),
    fullTimeSearches: (
      process.env.LINKEDIN_FT_SEARCH_URLS ||
      [
        'https://www.linkedin.com/jobs/search/?keywords=new%20grad%20software%20engineer%202027&f_E=2&sortBy=DD',
        'https://www.linkedin.com/jobs/search/?keywords=entry%20level%20software%20developer%202027&f_E=2&sortBy=DD',
        'https://www.linkedin.com/jobs/search/?keywords=software%20engineer%20new%20grad%20may%202027&f_E=2&sortBy=DD',
        'https://www.linkedin.com/jobs/search/?keywords=new%20grad%20full%20stack%20developer%202027&f_E=2&sortBy=DD',
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
        'https://jobright.ai/jobs/search?value=Summer+2027+Internship+Software&country=US&isH1BOnly=false&excludeStaffingAgency=false&excludeSecurityClearance=false&excludeUsCitizen=false&refresh=true&position=0&sortCondition=1&searchType=job_title&jobTaxonomyList=%5B%7B%22taxonomyId%22%3A%2200-00-00%22%2C%22title%22%3A%22Summer+2027+Internship+Software%22%7D%5D',
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
        'https://www.indeed.com/jobs?q=summer+2027+software+engineering+intern&sort=date',
        'https://www.indeed.com/jobs?q=summer+2027+software+developer+intern&sort=date',
        'https://www.indeed.com/jobs?q=summer+2027+computer+science+internship&sort=date',
        'https://www.indeed.com/jobs?q=summer+2027+full+stack+intern&sort=date',
        'https://www.indeed.com/jobs?q=summer+2027+SWE+intern&sort=date',
      ].join('|')
    )
      .split('|')
      .map((u) => u.trim())
      .filter(Boolean),
    fullTimeSearches: (
      process.env.INDEED_FT_SEARCH_URLS ||
      [
        'https://www.indeed.com/jobs?q=new+grad+software+engineer+2027&sort=date',
        'https://www.indeed.com/jobs?q=entry+level+software+developer+2027&sort=date',
        'https://www.indeed.com/jobs?q=software+engineer+new+grad&sort=date',
        'https://www.indeed.com/jobs?q=new+grad+full+stack+developer&sort=date',
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

  scheduler: {
    enabled: process.env.SCHEDULER_ENABLED !== 'false',
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
      'US Citizen',
      'USA Citizen',
      'U.S. Citizen',
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
    /** -1 = no experience cap */
    currentExperience: Number(process.env.CURRENT_EXPERIENCE ?? 3),
  },
};

function parseEnvList(raw: string | undefined, defaults: string[]): string[] {
  if (!raw?.trim()) return defaults;
  return raw
    .split(/[|,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}
