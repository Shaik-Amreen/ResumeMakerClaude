/** Strip Jobright / LinkedIn / HTML noise so the model sees the real JD. */
export function cleanJobDescriptionForResume(raw: string): string {
  let jd = (raw || '').trim();
  if (!jd) return jd;

  // Pasted HTML job posts (Greenhouse/Workday copy) — strip tags before anything else.
  if (/<\/?[a-z][\s\S]*>/i.test(jd) || /&nbsp;|&amp;|&lt;/i.test(jd)) {
    jd = jd
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, '\n')
      .replace(/<li[^>]*>/gi, '\n• ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/&quot;/gi, '"')
      .replace(/&#\d+;/g, ' ');
  }

  const startMarkers = [
    'Original Job Post',
    'Job Summary',
    'Responsibilities',
    'Qualification',
    'Qualifications',
    'Job Description',
    'Job Expectations',
    'About the role',
    "What you'll do",
    'Required',
    'Knowledge, Skills',
  ];
  for (const marker of startMarkers) {
    const idx = jd.indexOf(marker);
    if (idx >= 0 && idx < 8000) {
      jd = jd.slice(idx);
      break;
    }
  }

  const endMarkers = [
    'Company data provided by crunchbase',
    'AI Tools',
    'Customize Your Resume',
    'Build Cover Letter',
    'Analyze How Well You Fit',
    'Turbo for Students',
    'Job Recommendations | Jobright AI',
    'Why this job is a match',
    'Job Recommendations',
    'Staffing Agency Submission Notice',
    'Anticipated Pay Scale',
    'content-pay-transparency',
    'About iHerb',
    'iHerb Benefits',
    'Equal Opportunity',
  ];
  for (const marker of endMarkers) {
    const idx = jd.search(new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
    if (idx > 200) {
      jd = jd.slice(0, idx).trim();
      break;
    }
  }

  // If the paste includes multiple Jobright cards, keep only the first job block
  const nextCard = jd.search(
    /\n(?:Be an early applicant|Software (?:Engineer|Development|Developer) Intern)/i
  );
  if (nextCard > 400) {
    jd = jd.slice(0, nextCard).trim();
  }

  jd = jd
    .replace(/^(Jobs\n|Resume\n|Profile\n|Agent\n|Coaching\n|Interview\n)+/i, '')
    .replace(/APPLY WITH AUTOFILL\n/gi, '')
    .replace(/Overview\nCompany\nShare\nReport Issue\n/gi, '')
    .replace(/Less than \d+ applicants/gi, '')
    .replace(/\d+%\s*STRONG MATCH/gi, '')
    .replace(/\b(?:checkPHP|checkHTML|checkCSS|checkJavaScript)\b/g, '')
    .replace(/\bFeedBlockStory\b[\s\S]{0,200}/gi, ' ')
    .replace(/\bThemeableIconButtonPresentation\b[\s\S]{0,80}/gi, ' ')
    .replace(/\bTruncatedRichText\b/gi, ' ')
    .replace(/#LI-[A-Z0-9]+\b/gi, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();

  return jd || raw.trim();
}
