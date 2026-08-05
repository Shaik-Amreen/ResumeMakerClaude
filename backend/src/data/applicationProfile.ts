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
  /** Default when form only asks a single sponsorship question. */
  requireVisa: string;
  /** "Are you legally authorized to work in the U.S.?" */
  legallyAuthorizedToWorkInUS: string;
  /** "Do you now require sponsorship?" — No while on F-1 OPT. */
  nowRequireSponsorship: string;
  /** "Will you require sponsorship in the future?" — No. */
  futureRequireSponsorship: string;
  usCitizenship: string;
  gender: string;
  ethnicity: string;
  disabilityStatus: string;
  veteranStatus: string;
  desiredSalary: number;
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
    'I am excited to apply for this full-time Software Engineer opportunity. As a Software Engineer Intern at Amazon, I built batch data remediation on AWS Lambda, DynamoDB, and SQS, automated infrastructure with AWS CDK and CI/CD, and shipped an AI assistant skill for operational workflows. Combined with experience at Associated Students, Inc. at CSULB and Infobell IT Solutions, I look forward to contributing strong full-stack and cloud engineering skills to your team.',
  yearsOfExperience: '3+',
  /**
   * Visa answers:
   * Career KB says future sponsorship Yes (H-1B).
   * User override (2026-08-03): future sponsorship No.
   */
  requireVisa: 'No',
  legallyAuthorizedToWorkInUS: 'Yes',
  nowRequireSponsorship: 'No',
  futureRequireSponsorship: 'No',
  usCitizenship:
    'Not a U.S. citizen or permanent resident. Authorized to work under F-1 OPT; does not require sponsorship now. Future sponsorship: No (per candidate).',
  gender: 'Decline',
  ethnicity: 'Decline',
  disabilityStatus: 'Decline',
  veteranStatus: 'Decline',
  desiredSalary: 0, // UNKNOWN per career KB — do not invent $150k
  currentCtc: 0,
  noticePeriodDays: 0,
  confidenceLevel: '8',
  overwritePreviousAnswers: false,
  userInformationAll: formatResumeProfileForPrompt(),
};

export function formatSalary(amount: number, label: string): string {
  const lower = label.toLowerCase();
  if (lower.includes('lakh')) {
    const lakhs = amount / 100000;
    return lakhs.toFixed(2);
  }
  if (lower.includes('month')) {
    return String(Math.round(amount / 12));
  }
  return String(amount);
}
