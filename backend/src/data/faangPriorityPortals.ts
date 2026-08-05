/**
 * Highest-priority FAANG university / new-grad career portals.
 * Scraped before GitHub lists and Jobright.
 */
export interface FaangPortalTarget {
  name: string;
  /** Program / landing page (informational) */
  programUrl?: string;
  /** Search / listing URL used by the scraper */
  searchUrl: string;
  /** Optional JSON API (Amazon) */
  apiKind?: 'amazon';
}

export const FAANG_PRIORITY_PORTALS: FaangPortalTarget[] = [
  {
    name: 'Amazon',
    programUrl: 'https://www.amazon.jobs/content/en/career-programs/university/',
    searchUrl:
      'https://www.amazon.jobs/en/search?base_query=software%20development%20engineer%20new%20grad&loc_query=United%20States',
    apiKind: 'amazon',
  },
  {
    name: 'Microsoft',
    programUrl: 'https://careers.microsoft.com/v2/global/en/universityrecruiting',
    searchUrl:
      'https://jobs.careers.microsoft.com/global/en/search?q=software%20engineer%20new%20grad&lc=United%20States&l=en_us',
  },
  {
    name: 'Meta',
    programUrl: 'https://www.metacareers.com/careerprograms/students',
    searchUrl: 'https://www.metacareers.com/jobs?q=software%20engineer%20university%20grad',
  },
  {
    name: 'Apple',
    searchUrl: 'https://jobs.apple.com/en-us/search?team=software-and-services-SFTWR-SOFTSRV',
  },
  {
    name: 'Google',
    programUrl: 'https://buildyourfuture.withgoogle.com/',
    searchUrl:
      'https://www.google.com/about/careers/applications/jobs/results/?q=software%20engineer%20new%20grad&location=United%20States',
  },
];

/** GitHub curated new-grad / early-career SWE lists. */
export const GITHUB_INTERNSHIP_LISTS = [
  {
    name: 'SimplifyJobs/New-Grad-Positions',
    /** Primary: https://github.com/SimplifyJobs/New-Grad-Positions */
    rawUrl: 'https://raw.githubusercontent.com/SimplifyJobs/New-Grad-Positions/dev/README.md',
  },
  {
    name: 'speedyapply/2027-SWE-College-Jobs',
    rawUrl: 'https://raw.githubusercontent.com/speedyapply/2027-SWE-College-Jobs/main/README.md',
  },
];

/**
 * Simplify curated web lists (Typesense-backed).
 * Top-New-Grad: https://simplify.jobs/l/Top-New-Grad
 */
export interface SimplifyJobListTarget {
  name: string;
  slug: string;
  listId: string;
  pageUrl: string;
  /** Typesense filter fragment(s) AND-ed with job_lists filter */
  functionFilters?: string[];
}

export const SIMPLIFY_NEW_GRAD_LISTS: SimplifyJobListTarget[] = [
  {
    name: 'Simplify Top New Grad',
    slug: 'Top-New-Grad',
    listId: '9d79d24b-7028-4c73-a68b-a2fa322b65e8',
    pageUrl: 'https://simplify.jobs/l/Top-New-Grad',
    functionFilters: ['Software Engineering', 'Backend Engineering', 'Frontend Engineering', 'Full Stack'],
  },
];
