import { formatResumeProfileForPrompt, resumeProfile } from './resumeProfile';

/** Answers for LinkedIn Easy Apply forms — derived from resume profile. */
export interface ApplicationProfile {
  firstName: string;
  middleName: string;
  lastName: string;
  fullName: string;
  phone: string;
  email: string;
  currentCity: string;
  street: string;
  state: string;
  zipcode: string;
  country: string;
  linkedin: string;
  website: string;
  recentEmployer: string;
  linkedinHeadline: string;
  linkedinSummary: string;
  coverLetter: string;
  yearsOfExperience: string;
  /**
   * Default for single ambiguous sponsorship questions
   * ("Do you require sponsorship?") — Yes (future H-1B path).
   */
  requireVisa: string;
  /** "Are you legally authorized to work in the U.S.?" */
  legallyAuthorizedToWorkInUS: string;
  /** "Do you now require sponsorship?" — No while OPT-eligible. */
  nowRequireSponsorship: string;
  /** "Will you require sponsorship in the future?" — Yes (H-1B). */
  futureRequireSponsorship: string;
  usCitizenship: string;
  willingToRelocate: string;
  desiredStartDate: string;
  gender: string;
  ethnicity: string;
  disabilityStatus: string;
  veteranStatus: string;
  /** Midpoint placeholder; prefer desiredSalaryMin/Max for forms. */
  desiredSalary: number;
  desiredSalaryMin: number;
  desiredSalaryMax: number;
  /** Used when a salary field is required but range cannot be entered. */
  salaryFormFallback: string;
  currentCtc: number;
  noticePeriodDays: number;
  confidenceLevel: string;
  overwritePreviousAnswers: boolean;
  userInformationAll: string;
}

function splitName(fullName: string) {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], middleName: '', lastName: '' };
  if (parts.length === 2) return { firstName: parts[0], middleName: '', lastName: parts[1] };
  return {
    firstName: parts[0],
    middleName: parts.slice(1, -1).join(' '),
    lastName: parts[parts.length - 1],
  };
}

const { firstName, middleName, lastName } = splitName(resumeProfile.name);

export const applicationProfile: ApplicationProfile = {
  firstName,
  middleName,
  lastName,
  fullName: resumeProfile.name,
  phone: resumeProfile.phone,
  email: resumeProfile.email,
  currentCity: 'Long Beach',
  street: '',
  state: 'California',
  zipcode: '',
  country: 'United States',
  linkedin: resumeProfile.linkedin,
  website: resumeProfile.portfolio,
  recentEmployer: 'Amazon',
  linkedinHeadline:
    'Software Engineer Intern @ Amazon | MS Computer Science @ CSULB | Full Stack | React • Node.js • Java • AWS • GraphQL',
  linkedinSummary:
    'Software engineer and M.S. Computer Science student at California State University, Long Beach with 3+ years of experience building production web, mobile, and cloud applications. Currently a Software Engineer Intern at Amazon (May–Aug 2026), working on AWS Lambda, DynamoDB, SQS, CDK, and CI/CD. I enjoy building scalable software and delivering accessible user experiences. Seeking full-time Software Engineering opportunities beginning after graduation in January 2027.',
  coverLetter:
    'Dear Hiring Team,\n\nI am excited to apply for this full-time Software Engineer opportunity. I am an M.S. Computer Science student at California State University, Long Beach (CSULB), graduating in January 2027.\n\nAs a Software Engineer Intern at Amazon, I built batch data remediation on AWS Lambda, DynamoDB, and SQS, automated infrastructure with AWS CDK and CI/CD, and shipped an AI assistant skill for operational workflows. Combined with experience at Associated Students, Inc. at CSULB and Infobell IT Solutions, I look forward to contributing strong full-stack and cloud engineering skills to your team.\n\nThank you for your time and consideration.\n\nSincerely,\nKarthik Kovi',
  yearsOfExperience: '3+',
  /**
   * Visa (2026-08-10 follow-up):
   * now = No; future = Yes; ambiguous single = Yes; now-or-future = Yes.
   * Skip JDs that refuse sponsorship / require auth without sponsorship.
   */
  requireVisa: 'Yes',
  legallyAuthorizedToWorkInUS: 'Yes',
  nowRequireSponsorship: 'No',
  futureRequireSponsorship: 'Yes',
  usCitizenship:
    'Not a U.S. citizen or permanent resident. Authorized to work under F-1 OPT; does not require sponsorship now. Will require H-1B or equivalent employer sponsorship in the future.',
  willingToRelocate: 'Yes',
  desiredStartDate: 'January 2027',
  gender: 'Decline',
  ethnicity: 'Decline',
  disabilityStatus: 'Decline',
  veteranStatus: 'Decline',
  desiredSalary: 0,
  desiredSalaryMin: 120000,
  desiredSalaryMax: 170000,
  salaryFormFallback: 'Negotiable',
  currentCtc: 0,
  noticePeriodDays: 0,
  confidenceLevel: '8',
  overwritePreviousAnswers: false,
  userInformationAll: formatResumeProfileForPrompt(),
};

/** Human range for answer bank / free-text salary fields. */
export function formatDesiredSalaryRange(profile: ApplicationProfile = applicationProfile): string {
  if (profile.desiredSalaryMin > 0 && profile.desiredSalaryMax > 0) {
    return `$${profile.desiredSalaryMin.toLocaleString('en-US')} - $${profile.desiredSalaryMax.toLocaleString('en-US')}`;
  }
  return profile.salaryFormFallback || 'Negotiable';
}

/**
 * Form salary fill:
 * - Prefer $120k–$170k range when numeric amount is unset
 * - If amount is 0 and label looks required → Negotiable / N/A
 * - If amount is 0 and optional → blank
 */
export function formatSalary(amount: number, label: string, profile: ApplicationProfile = applicationProfile): string {
  const lower = label.toLowerCase();
  if (lower.includes('lakh')) {
    const lakhs = (amount > 0 ? amount : profile.desiredSalaryMin) / 100000;
    return lakhs.toFixed(2);
  }
  if (lower.includes('month')) {
    const annual = amount > 0 ? amount : Math.round((profile.desiredSalaryMin + profile.desiredSalaryMax) / 2);
    return String(Math.round(annual / 12));
  }
  if (amount > 0) return String(amount);
  if (profile.desiredSalaryMin > 0 && profile.desiredSalaryMax > 0) {
    return formatDesiredSalaryRange(profile);
  }
  if (/\b(?:required|must|mandatory)\b/i.test(label)) {
    return profile.salaryFormFallback || 'Negotiable';
  }
  // Optional / unknown → leave blank
  return '';
}
