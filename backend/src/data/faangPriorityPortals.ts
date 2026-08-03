/**
 * Highest-priority FAANG university / internship career portals.
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
    programUrl: 'https://www.amazon.jobs/content/en/career-programs/university/internships-for-students/',
    searchUrl: 'https://www.amazon.jobs/en/search?base_query=software%20development%20engineer%20intern%202027&loc_query=United%20States',
    apiKind: 'amazon',
  },
  {
    name: 'Microsoft',
    programUrl: 'https://careers.microsoft.com/v2/global/en/universityinternship',
    searchUrl:
      'https://jobs.careers.microsoft.com/global/en/search?q=software%20engineering%20intern&lc=United%20States&l=en_us',
  },
  {
    name: 'Meta',
    programUrl: 'https://www.metacareers.com/careerprograms/students',
    searchUrl: 'https://www.metacareers.com/jobs?q=software%20engineer%20intern%20summer%202027',
  },
  {
    name: 'Apple',
    searchUrl: 'https://jobs.apple.com/en-us/search?team=internships-STDNT-INTRN',
  },
  {
    name: 'Google',
    programUrl: 'https://buildyourfuture.withgoogle.com/internships',
    searchUrl:
      'https://www.google.com/about/careers/applications/jobs/results/?q=software%20engineering%20intern%202027&location=United%20States',
  },
];

/** GitHub curated Summer 2027 SWE internship lists (phase 2). */
export const GITHUB_INTERNSHIP_LISTS = [
  {
    name: 'speedyapply/2027-SWE-College-Jobs',
    rawUrl: 'https://raw.githubusercontent.com/speedyapply/2027-SWE-College-Jobs/main/README.md',
  },
  {
    name: 'vanshb03/Summer2027-Internships',
    rawUrl: 'https://raw.githubusercontent.com/vanshb03/Summer2027-Internships/dev/README.md',
  },
];
