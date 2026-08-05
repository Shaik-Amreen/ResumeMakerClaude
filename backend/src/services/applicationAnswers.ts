import { ApplicationProfile, formatSalary } from '../data/applicationProfile';

export function answerCommonQuestions(
  label: string,
  answer: string,
  profile: ApplicationProfile
): string {
  const lower = label.toLowerCase();

  if (
    lower.includes('legally authorized') ||
    lower.includes('authorized to work') ||
    lower.includes('eligible to work') ||
    lower.includes('work authorization')
  ) {
    return profile.legallyAuthorizedToWorkInUS;
  }

  if (
    (lower.includes('sponsorship') || lower.includes('visa') || lower.includes('h-1b') || lower.includes('h1b')) &&
    (lower.includes('future') || lower.includes('will you') || lower.includes('require in the future') || lower.includes('later'))
  ) {
    return profile.futureRequireSponsorship;
  }

  if (
    (lower.includes('sponsorship') || lower.includes('visa')) &&
    (lower.includes('now') || lower.includes('currently') || lower.includes('present'))
  ) {
    return profile.nowRequireSponsorship;
  }

  if (lower.includes('sponsorship') || lower.includes('visa') || lower.includes('h-1b') || lower.includes('h1b')) {
    // Single ambiguous sponsorship question — use requireVisa (No).
    return profile.requireVisa;
  }

  return answer;
}

export function yesNoPhrases(answer: string): string[] {
  if (answer === 'Decline') {
    return ['Decline', 'not wish', "don't wish", 'Prefer not', 'not want'];
  }
  if (answer.toLowerCase().includes('yes')) {
    return ['Yes', 'Agree', 'I do', 'I have'];
  }
  if (answer.toLowerCase().includes('no')) {
    return ['No', 'Disagree', "I don't", 'I do not'];
  }
  return [answer, answer.toLowerCase(), answer.toUpperCase(), answer.replace(/[^a-zA-Z0-9]/g, '')];
}

export function resolveTextAnswer(
  label: string,
  profile: ApplicationProfile,
  workLocation: string
): { answer: string; needsAutocomplete: boolean } {
  let answer = '';
  let needsAutocomplete = false;
  const lower = label.toLowerCase();

  if (lower.includes('experience') || lower.includes('years')) {
    answer = profile.yearsOfExperience;
  } else if (lower.includes('phone') || lower.includes('mobile')) {
    answer = profile.phone;
  } else if (lower.includes('street')) {
    answer = profile.street;
  } else if (lower.includes('city') || lower.includes('location') || lower.includes('address')) {
    answer = profile.currentCity || workLocation;
    needsAutocomplete = true;
  } else if (lower.includes('signature') || (lower.includes('name') && lower.includes('legal'))) {
    answer = profile.fullName;
  } else if (lower.includes('name')) {
    if (lower.includes('full')) answer = profile.fullName;
    else if (lower.includes('first') && !lower.includes('last')) answer = profile.firstName;
    else if (lower.includes('middle') && !lower.includes('last')) answer = profile.middleName;
    else if (lower.includes('last') && !lower.includes('first')) answer = profile.lastName;
    else if (lower.includes('employer')) answer = profile.recentEmployer;
    else answer = profile.fullName;
  } else if (lower.includes('notice')) {
    if (lower.includes('month')) answer = String(Math.floor(profile.noticePeriodDays / 30));
    else if (lower.includes('week')) answer = String(Math.floor(profile.noticePeriodDays / 7));
    else answer = String(profile.noticePeriodDays);
  } else if (
    lower.includes('salary') ||
    lower.includes('compensation') ||
    lower.includes('ctc') ||
    lower.includes('pay')
  ) {
    const isCurrent = lower.includes('current') || lower.includes('present');
    const amount = isCurrent ? profile.currentCtc : profile.desiredSalary;
    answer = formatSalary(amount, label);
  } else if (lower.includes('linkedin')) {
    answer = profile.linkedin;
  } else if (
    lower.includes('website') ||
    lower.includes('blog') ||
    lower.includes('portfolio') ||
    (lower.includes('link') && !lower.includes('linkedin'))
  ) {
    answer = profile.website;
  } else if (lower.includes('scale of 1-10')) {
    answer = profile.confidenceLevel;
  } else if (lower.includes('headline')) {
    answer = profile.linkedinHeadline;
  } else if (lower.includes('state') || lower.includes('province')) {
    answer = profile.state;
  } else if (lower.includes('zip') || lower.includes('postal') || lower.includes('code')) {
    answer = profile.zipcode;
  } else if (lower.includes('country')) {
    answer = profile.country;
  } else if (lower.includes('email')) {
    answer = profile.email;
  } else {
    answer = answerCommonQuestions(label, answer, profile);
  }

  return { answer, needsAutocomplete };
}

export function resolveSelectAnswer(
  label: string,
  profile: ApplicationProfile,
  workLocation: string
): string {
  const lower = label.toLowerCase();
  if (lower.includes('email') || lower.includes('phone')) return '';
  if (lower.includes('gender') || lower.includes('sex')) return profile.gender;
  if (lower.includes('disability')) return profile.disabilityStatus;
  if (lower.includes('proficiency')) return 'Professional';
  if (lower.includes('country')) return profile.country;
  if (lower.includes('state')) return profile.state;
  if (lower.includes('city')) return profile.currentCity || workLocation;
  if (
    lower.includes('location') ||
    lower.includes('city') ||
    lower.includes('state') ||
    lower.includes('country')
  ) {
    return workLocation;
  }
  return answerCommonQuestions(label, 'Yes', profile);
}

export function resolveRadioAnswer(label: string, profile: ApplicationProfile): string {
  const lower = label.toLowerCase();
  if (lower.includes('citizenship') || lower.includes('employment eligibility')) {
    return profile.usCitizenship;
  }
  if (lower.includes('veteran') || lower.includes('protected')) {
    return profile.veteranStatus;
  }
  if (lower.includes('disability') || lower.includes('handicapped')) {
    return profile.disabilityStatus;
  }
  return answerCommonQuestions(label, 'Yes', profile);
}

export function resolveTextareaAnswer(label: string, profile: ApplicationProfile): string {
  const lower = label.toLowerCase();
  if (lower.includes('summary')) return profile.linkedinSummary;
  if (lower.includes('cover')) return profile.coverLetter;
  return '';
}
