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
  requireVisa: string;
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
  zipcode: '90840',
  country: 'United States',
  linkedin: resumeProfile.linkedin,
  website: resumeProfile.portfolio,
  recentEmployer: 'Associated Students Inc. (ASI), CSULB',
  linkedinHeadline: resumeProfile.headline,
  linkedinSummary: `MS Computer Science student at CSULB (May 2027) with 3+ years of full-stack experience (React, Node.js, TypeScript, AWS). Previously Senior Software Engineer at AMD/Infobell serving 100K+ users.`,
  coverLetter: '',
  yearsOfExperience: '3',
  requireVisa: 'Yes',
  usCitizenship: 'Non-citizen allowed to work for any employer',
  gender: 'Decline',
  ethnicity: 'Decline',
  disabilityStatus: 'Decline',
  veteranStatus: 'Decline',
  desiredSalary: 120000,
  currentCtc: 0,
  noticePeriodDays: 14,
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
