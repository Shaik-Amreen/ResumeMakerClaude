export type CompanyTier = 'faang' | 'mango' | 'standard';

export interface CompanyTarget {
  name: string;
  tier: CompanyTier;
  /** Career site search or listing URL filtered for SWE interns */
  searchUrl: string;
}

/** FAANG + MANGOES — email alert on any new Summer 2027 software intern match */
export const FAANG_MANGO_COMPANIES: CompanyTarget[] = [
  {
    name: 'Google',
    tier: 'faang',
    searchUrl:
      'https://www.google.com/about/careers/applications/jobs/results/?q=software%20engineering%20intern%202027&location=United%20States',
  },
  {
    name: 'Meta',
    tier: 'faang',
    searchUrl: 'https://www.metacareers.com/jobs?q=software%20engineer%20intern%20summer%202027',
  },
  {
    name: 'Amazon',
    tier: 'faang',
    searchUrl:
      'https://www.amazon.jobs/en/search?base_query=software%20development%20engineer%20intern%202027&loc_query=United%20States',
  },
  {
    name: 'Apple',
    tier: 'faang',
    searchUrl: 'https://jobs.apple.com/en-us/search?team=internships-STDNT-INTRN',
  },
  {
    name: 'Netflix',
    tier: 'faang',
    searchUrl: 'https://explore.jobs.netflix.net/careers?query=software%20intern%202027',
  },
  {
    name: 'Microsoft',
    tier: 'mango',
    searchUrl:
      'https://jobs.careers.microsoft.com/global/en/search?q=software%20engineering%20intern&lc=United%20States&l=en_us',
  },
  {
    name: 'Nvidia',
    tier: 'mango',
    searchUrl: 'https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite?q=software%20intern%202027',
  },
  {
    name: 'Oracle',
    tier: 'mango',
    searchUrl: 'https://careers.oracle.com/jobs/#en/sites/jobsearch/requisitions?keyword=software%20intern',
  },
  {
    name: 'Salesforce',
    tier: 'mango',
    searchUrl: 'https://careers.salesforce.com/en/jobs/?search=software%20engineering%20intern',
  },
  {
    name: 'Adobe',
    tier: 'mango',
    searchUrl: 'https://careers.adobe.com/us/en/search-results?keywords=software%20intern',
  },
  {
    name: 'Uber',
    tier: 'mango',
    searchUrl: 'https://www.uber.com/us/en/careers/list/?query=software%20engineering%20intern',
  },
  {
    name: 'Airbnb',
    tier: 'mango',
    searchUrl: 'https://careers.airbnb.com/positions/?_departments=engineering&search=intern',
  },
  {
    name: 'Stripe',
    tier: 'mango',
    searchUrl: 'https://stripe.com/jobs/search?q=software%20intern',
  },
  {
    name: 'LinkedIn',
    tier: 'mango',
    searchUrl: 'https://careers.linkedin.com/reach/search?query=software%20engineering%20intern',
  },
  {
    name: 'Tesla',
    tier: 'mango',
    searchUrl: 'https://www.tesla.com/careers/search/?query=software%20intern',
  },
  {
    name: 'AMD',
    tier: 'mango',
    searchUrl: 'https://careers.amd.com/careers-home/jobs?keywords=software%20intern',
  },
];

/** Additional companies checked overnight on career portals */
export const EXTENDED_CAREER_COMPANIES: CompanyTarget[] = [
  ...FAANG_MANGO_COMPANIES,
  {
    name: 'Palantir',
    tier: 'standard',
    searchUrl: 'https://jobs.lever.co/palantir?team=Engineering&commitment=Internship',
  },
  {
    name: 'Databricks',
    tier: 'standard',
    searchUrl:
      'https://www.databricks.com/company/careers/open-positions?department=University&location=United%20States',
  },
  {
    name: 'Snowflake',
    tier: 'standard',
    searchUrl: 'https://careers.snowflake.com/us/en/search-results?keywords=summer%202027%20intern',
  },
  {
    name: 'Coinbase',
    tier: 'standard',
    searchUrl: 'https://www.coinbase.com/careers/positions?query=intern',
  },
  {
    name: 'Snap',
    tier: 'standard',
    searchUrl: 'https://careers.snap.com/jobs?search=software%20intern',
  },
  {
    name: 'Pinterest',
    tier: 'standard',
    searchUrl: 'https://www.pinterestcareers.com/jobs/?search=software%20intern',
  },
  {
    name: 'Spotify',
    tier: 'standard',
    searchUrl: 'https://www.lifeatspotify.com/jobs?search=intern',
  },
  {
    name: 'Intuit',
    tier: 'standard',
    searchUrl: 'https://jobs.intuit.com/search-jobs/intern%20software',
  },
  {
    name: 'PayPal',
    tier: 'standard',
    searchUrl: 'https://careers.pypl.com/home/search-results?keywords=software%20intern',
  },
  {
    name: 'Shopify',
    tier: 'standard',
    searchUrl: 'https://www.shopify.com/careers/search?query=intern',
  },
];

export function isFaangMangoCompany(companyName: string): boolean {
  const norm = companyName.trim().toLowerCase();
  return FAANG_MANGO_COMPANIES.some((c) => norm.includes(c.name.toLowerCase()));
}

export function companyTier(companyName: string): CompanyTier {
  const norm = companyName.trim().toLowerCase();
  const hit = FAANG_MANGO_COMPANIES.find((c) => norm.includes(c.name.toLowerCase()));
  return hit?.tier ?? 'standard';
}
