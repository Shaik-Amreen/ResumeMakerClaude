import { ApplicationProfile, formatSalary } from '../data/applicationProfile';

export function answerCommonQuestions(
  label: string,
  answer: string,
  profile: ApplicationProfile
): string {
  if (label.includes('sponsorship') || label.includes('visa')) {
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

  if (label.includes('experience') || label.includes('years')) {
    answer = profile.yearsOfExperience;
  } else if (label.includes('phone') || label.includes('mobile')) {
    answer = profile.phone;
  } else if (label.includes('street')) {
    answer = profile.street;
  } else if (label.includes('city') || label.includes('location') || label.includes('address')) {
    answer = profile.currentCity || workLocation;
    needsAutocomplete = true;
  } else if (label.includes('signature') || (label.includes('name') && label.includes('legal'))) {
    answer = profile.fullName;
  } else if (label.includes('name')) {
    if (label.includes('full')) answer = profile.fullName;
    else if (label.includes('first') && !label.includes('last')) answer = profile.firstName;
    else if (label.includes('middle') && !label.includes('last')) answer = profile.middleName;
    else if (label.includes('last') && !label.includes('first')) answer = profile.lastName;
    else if (label.includes('employer')) answer = profile.recentEmployer;
    else answer = profile.fullName;
  } else if (label.includes('notice')) {
    if (label.includes('month')) answer = String(Math.floor(profile.noticePeriodDays / 30));
    else if (label.includes('week')) answer = String(Math.floor(profile.noticePeriodDays / 7));
    else answer = String(profile.noticePeriodDays);
  } else if (
    label.includes('salary') ||
    label.includes('compensation') ||
    label.includes('ctc') ||
    label.includes('pay')
  ) {
    const isCurrent = label.includes('current') || label.includes('present');
    const amount = isCurrent ? profile.currentCtc : profile.desiredSalary;
    answer = formatSalary(amount, label);
  } else if (label.includes('linkedin')) {
    answer = profile.linkedin;
  } else if (
    label.includes('website') ||
    label.includes('blog') ||
    label.includes('portfolio') ||
    (label.includes('link') && !label.includes('linkedin'))
  ) {
    answer = profile.website;
  } else if (label.includes('scale of 1-10')) {
    answer = profile.confidenceLevel;
  } else if (label.includes('headline')) {
    answer = profile.linkedinHeadline;
  } else if (label.includes('state') || label.includes('province')) {
    answer = profile.state;
  } else if (label.includes('zip') || label.includes('postal') || label.includes('code')) {
    answer = profile.zipcode;
  } else if (label.includes('country')) {
    answer = profile.country;
  } else if (label.includes('email')) {
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
  if (label.includes('email') || label.includes('phone')) return '';
  if (label.includes('gender') || label.includes('sex')) return profile.gender;
  if (label.includes('disability')) return profile.disabilityStatus;
  if (label.includes('proficiency')) return 'Professional';
  if (label.includes('country')) return profile.country;
  if (label.includes('state')) return profile.state;
  if (label.includes('city')) return profile.currentCity || workLocation;
  if (
    label.includes('location') ||
    label.includes('city') ||
    label.includes('state') ||
    label.includes('country')
  ) {
    return workLocation;
  }
  return answerCommonQuestions(label, 'Yes', profile);
}

export function resolveRadioAnswer(label: string, profile: ApplicationProfile): string {
  if (label.includes('citizenship') || label.includes('employment eligibility')) {
    return profile.usCitizenship;
  }
  if (label.includes('veteran') || label.includes('protected')) {
    return profile.veteranStatus;
  }
  if (label.includes('disability') || label.includes('handicapped')) {
    return profile.disabilityStatus;
  }
  return answerCommonQuestions(label, 'Yes', profile);
}

export function resolveTextareaAnswer(label: string, profile: ApplicationProfile): string {
  if (label.includes('summary')) return profile.linkedinSummary;
  if (label.includes('cover')) return profile.coverLetter;
  return '';
}
