export type CompanyTier = 'faang' | 'mango' | 'standard';

export interface CompanyTarget {
  name: string;
  tier: CompanyTier;
  /** Career site search or listing URL filtered for SWE full-time / new grad */
  searchUrl: string;
}

/** FAANG + MANGOES — email alert on any new full-time / new-grad SWE match */
export const FAANG_MANGO_COMPANIES: CompanyTarget[] = [
  {
    name: 'Google',
    tier: 'faang',
    searchUrl:
      'https://www.google.com/about/careers/applications/jobs/results/?q=software%20engineer%20new%20grad&location=United%20States',
  },
  {
    name: 'Meta',
    tier: 'faang',
    searchUrl: 'https://www.metacareers.com/jobs?q=software%20engineer%20university%20grad',
  },
  {
    name: 'Amazon',
    tier: 'faang',
    searchUrl:
      'https://www.amazon.jobs/en/search?base_query=software%20development%20engineer%20new%20grad&loc_query=United%20States',
  },
  {
    name: 'Apple',
    tier: 'faang',
    searchUrl: 'https://jobs.apple.com/en-us/search?team=software-and-services-SFTWR-SOFTSRV',
  },
  {
    name: 'Netflix',
    tier: 'faang',
    searchUrl: 'https://explore.jobs.netflix.net/careers?query=software%20engineer',
  },
  {
    name: 'Microsoft',
    tier: 'mango',
    searchUrl:
      'https://jobs.careers.microsoft.com/global/en/search?q=software%20engineer%20new%20grad&lc=United%20States&l=en_us',
  },
  {
    name: 'Nvidia',
    tier: 'mango',
    searchUrl: 'https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite?q=software%20engineer%20new%20grad',
  },
  {
    name: 'Oracle',
    tier: 'mango',
    searchUrl: 'https://careers.oracle.com/jobs/#en/sites/jobsearch/requisitions?keyword=software%20engineer%20new%20grad',
  },
  {
    name: 'Salesforce',
    tier: 'mango',
    searchUrl: 'https://careers.salesforce.com/en/jobs/?search=software%20engineer%20new%20grad',
  },
  {
    name: 'Adobe',
    tier: 'mango',
    searchUrl: 'https://careers.adobe.com/us/en/search-results?keywords=software%20engineer%20new%20grad',
  },
  {
    name: 'Uber',
    tier: 'mango',
    searchUrl: 'https://www.uber.com/us/en/careers/list/?query=software%20engineer',
  },
  {
    name: 'Airbnb',
    tier: 'mango',
    searchUrl: 'https://careers.airbnb.com/positions/?_departments=engineering&search=software%20engineer',
  },
  {
    name: 'Stripe',
    tier: 'mango',
    searchUrl: 'https://stripe.com/jobs/search?q=software%20engineer',
  },
  {
    name: 'LinkedIn',
    tier: 'mango',
    searchUrl: 'https://careers.linkedin.com/reach/search?query=software%20engineer%20new%20grad',
  },
  {
    name: 'Tesla',
    tier: 'mango',
    searchUrl: 'https://www.tesla.com/careers/search/?query=software%20engineer',
  },
  {
    name: 'AMD',
    tier: 'mango',
    searchUrl: 'https://careers.amd.com/careers-home/jobs?keywords=software%20engineer',
  },
  {
    name: 'Databricks',
    tier: 'mango',
    searchUrl:
      'https://www.databricks.com/company/careers/open-positions?department=University&location=United%20States',
  },
  {
    name: 'Snowflake',
    tier: 'mango',
    searchUrl: 'https://careers.snowflake.com/us/en/search-results?keywords=software%20engineer%20new%20grad',
  },
  {
    name: 'Intuit',
    tier: 'mango',
    searchUrl: 'https://jobs.intuit.com/search-jobs/software%20engineer',
  },
  {
    name: 'PayPal',
    tier: 'mango',
    searchUrl: 'https://careers.pypl.com/home/search-results?keywords=software%20engineer',
  },
  {
    name: 'ServiceNow',
    tier: 'mango',
    searchUrl: 'https://careers.servicenow.com/jobs/?search=software%20engineer%20new%20grad',
  },
  {
    name: 'Atlassian',
    tier: 'mango',
    searchUrl: 'https://www.atlassian.com/company/careers/all-jobs?team=Engineering&location=United%20States',
  },
  {
    name: 'Dropbox',
    tier: 'mango',
    searchUrl: 'https://jobs.dropbox.com/all-jobs?query=software%20engineer',
  },
  {
    name: 'GitHub',
    tier: 'mango',
    searchUrl: 'https://www.github.careers/careers-home/jobs?keywords=software%20engineer',
  },
  {
    name: 'Bloomberg',
    tier: 'mango',
    searchUrl: 'https://careers.bloomberg.com/job/search?q=software%20engineer',
  },
  {
    name: 'Capital One',
    tier: 'mango',
    searchUrl: 'https://www.capitalonecareers.com/search-jobs/software%20engineer',
  },
  {
    name: 'JPMorgan Chase',
    tier: 'mango',
    searchUrl: 'https://careers.jpmorgan.com/us/en/search-results?keywords=software%20engineer%20new%20grad',
  },
  {
    name: 'Goldman Sachs',
    tier: 'mango',
    searchUrl: 'https://www.goldmansachs.com/careers/students/programs/',
  },
  {
    name: 'Visa',
    tier: 'mango',
    searchUrl: 'https://jobs.smartrecruiters.com/Visa/search?q=software%20engineer',
  },
  {
    name: 'Mastercard',
    tier: 'mango',
    searchUrl: 'https://careers.mastercard.com/us/en/search-results?keywords=software%20engineer',
  },
  {
    name: 'Coinbase',
    tier: 'mango',
    searchUrl: 'https://www.coinbase.com/careers/positions?query=software%20engineer',
  },
  {
    name: 'Shopify',
    tier: 'mango',
    searchUrl: 'https://www.shopify.com/careers/search?query=software%20engineer',
  },
  {
    name: 'TikTok',
    tier: 'mango',
    searchUrl: 'https://careers.tiktok.com/position?keywords=software%20engineer&category=&location=United%20States',
  },
  {
    name: 'Roblox',
    tier: 'mango',
    searchUrl: 'https://careers.roblox.com/jobs?search=software%20engineer',
  },
];

/** Additional companies checked overnight on career portals */
export const EXTENDED_CAREER_COMPANIES: CompanyTarget[] = [
  ...FAANG_MANGO_COMPANIES,
  {
    name: 'Palantir',
    tier: 'standard',
    searchUrl: 'https://jobs.lever.co/palantir?team=Engineering',
  },
  {
    name: 'Snap',
    tier: 'standard',
    searchUrl: 'https://careers.snap.com/jobs?search=software%20engineer',
  },
  {
    name: 'Pinterest',
    tier: 'standard',
    searchUrl: 'https://www.pinterestcareers.com/jobs/?search=software%20engineer',
  },
  {
    name: 'Spotify',
    tier: 'standard',
    searchUrl: 'https://www.lifeatspotify.com/jobs?search=software%20engineer',
  },
  {
    name: 'Cisco',
    tier: 'standard',
    searchUrl: 'https://jobs.cisco.com/jobs/SearchJobs/?keyword=software%20engineer%20new%20grad',
  },
];

export function isFaangMangoCompany(companyName: string): boolean {
  const norm = companyName.trim().toLowerCase();
  return FAANG_MANGO_COMPANIES.some((c) => norm.includes(c.name.toLowerCase()));
}

export function companyTier(companyName: string): CompanyTier {
  const norm = companyName.trim().toLowerCase();
  const hit = FAANG_MANGO_COMPANIES.find((c) => norm.includes(c.name.toLowerCase()));
  return hit?.tier || 'standard';
}
