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
  /** "Will you require sponsorship in the future?" — Yes (H-1B). */
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
  recentEmployer: 'Associated Students, Inc. (ASI), CSULB',
  linkedinHeadline:
    'Software Engineer | MS Computer Science @ CSULB | Full Stack Engineer | React • Node.js • React Native • AWS • GraphQL | Building Scalable Software',
  linkedinSummary:
    'Software engineer and M.S. Computer Science student at California State University, Long Beach with 3+ years of experience building production web, mobile, and cloud applications. I enjoy building scalable software, improving developer productivity, and delivering accessible user experiences using React, React Native, Node.js, GraphQL, AWS, and modern engineering practices. I am seeking full-time Software Engineering opportunities beginning after graduation.',
  coverLetter:
    'I am excited to apply for this full-time Software Engineer opportunity. Through professional experience at Associated Students, Inc. at CSULB and Infobell IT Solutions, I have built production web and mobile applications serving thousands of users while improving accessibility, performance, and deployment automation. I look forward to contributing strong full-stack engineering skills and collaborating with your team to build reliable software that delivers measurable customer impact.',
  yearsOfExperience: '3+',
  requireVisa: 'Yes',
  legallyAuthorizedToWorkInUS: 'Yes',
  nowRequireSponsorship: 'No',
  futureRequireSponsorship: 'Yes',
  usCitizenship:
    'Not a U.S. citizen or permanent resident. Requires employment sponsorship for long-term work authorization.',
  gender: 'Decline',
  ethnicity: 'Decline',
  disabilityStatus: 'Decline',
  veteranStatus: 'Decline',
  desiredSalary: 150000,
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
