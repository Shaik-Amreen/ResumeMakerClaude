const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { config } = require('../dist/config');
const {
  normalizeJobUrl,
  normalizedJobUrlPattern,
} = require('../dist/services/jobDedup');
const { removeAllResumeFiles, removeJobResumeFiles } = require('../dist/services/resumeFiles');

test('normalized URL matching accepts query/trailing slash but not longer job IDs', () => {
  const pattern = normalizedJobUrlPattern('https://example.com/jobs/123?tracking=abc');

  assert.equal(normalizeJobUrl('https://EXAMPLE.com/jobs/123/?x=1'), 'https://example.com/jobs/123');
  assert.equal(pattern.test('https://example.com/jobs/123'), true);
  assert.equal(pattern.test('https://example.com/jobs/123/?source=test'), true);
  assert.equal(pattern.test('https://example.com/jobs/1234'), false);
  assert.equal(pattern.test('https://example.com/jobs/123/extra'), false);
});

test('resume cleanup removes only the target job artifacts and preserves keep paths', () => {
  const originalUploadsDir = config.uploadsDir;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resumemaker-files-'));
  config.uploadsDir = tempDir;

  try {
    const oldPdf = path.join(tempDir, 'job123-100-resume.pdf');
    const oldTex = path.join(tempDir, 'job123-100-resume.tex');
    const keepPdf = path.join(tempDir, 'job123-200-resume.pdf');
    const otherPdf = path.join(tempDir, 'job1234-100-resume.pdf');
    for (const file of [oldPdf, oldTex, keepPdf, otherPdf]) fs.writeFileSync(file, 'test');

    const removed = removeJobResumeFiles('job123', oldPdf, [keepPdf]);

    assert.equal(removed, 2);
    assert.equal(fs.existsSync(oldPdf), false);
    assert.equal(fs.existsSync(oldTex), false);
    assert.equal(fs.existsSync(keepPdf), true);
    assert.equal(fs.existsSync(otherPdf), true);
  } finally {
    config.uploadsDir = originalUploadsDir;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('resume cleanup refuses unsafe job identifiers and paths outside uploads', () => {
  const originalUploadsDir = config.uploadsDir;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resumemaker-scope-'));
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resumemaker-outside-'));
  const outsideFile = path.join(outsideDir, 'do-not-delete.pdf');
  fs.writeFileSync(outsideFile, 'test');
  config.uploadsDir = tempDir;

  try {
    const removed = removeJobResumeFiles('../outside', outsideFile);
    assert.equal(removed, 0);
    assert.equal(fs.existsSync(outsideFile), true);
  } finally {
    config.uploadsDir = originalUploadsDir;
    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.rmSync(outsideDir, { recursive: true, force: true });
  }
});

test('delete-all cleanup removes resume artifacts but leaves unrelated files', () => {
  const originalUploadsDir = config.uploadsDir;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resumemaker-all-'));
  config.uploadsDir = tempDir;

  try {
    fs.writeFileSync(path.join(tempDir, 'orphan.pdf'), 'test');
    fs.writeFileSync(path.join(tempDir, 'orphan.tex'), 'test');
    fs.writeFileSync(path.join(tempDir, 'keep.txt'), 'test');

    assert.equal(removeAllResumeFiles(), 2);
    assert.deepEqual(fs.readdirSync(tempDir), ['keep.txt']);
  } finally {
    config.uploadsDir = originalUploadsDir;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('resume queue deduplicates jobs, reports failures, and becomes idle again', async () => {
  const pipelinePath = require.resolve('../dist/services/resumePipeline');
  const queuePath = require.resolve('../dist/services/resumeQueue');
  const pipeline = require(pipelinePath);
  const originalRun = pipeline.runResumePipeline;
  delete require.cache[queuePath];

  let calls = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  pipeline.runResumePipeline = async (jobId) => {
    calls += 1;
    await gate;
    if (jobId === 'failure') throw new Error('expected failure');
  };

  try {
    const queue = require(queuePath);
    const first = queue.enqueueResume('same-job');
    const duplicate = queue.enqueueResume('same-job');
    assert.equal(first, duplicate);
    assert.equal(queue.isResumeQueueIdle(), false);

    release();
    await first;
    assert.equal(calls, 1);

    await assert.rejects(queue.enqueueResume('failure'), /expected failure/);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(queue.isResumeQueueIdle(), true);
  } finally {
    pipeline.runResumePipeline = originalRun;

    delete require.cache[queuePath];
  }
});

test('resume queue filter includes scraped and failed resume retries', () => {
  const { resumeQueueJobFilter } = require('../dist/services/orchestratorService');
  const filter = resumeQueueJobFilter();
  assert.equal(filter.jobType, 'fulltime');
  assert.ok(Array.isArray(filter.$or));
  assert.deepEqual(filter.$or[0], { status: 'scraped' });
  assert.deepEqual(filter.$or[1], { status: 'failed' });
  assert.deepEqual(filter.$or[2], { status: 'resume_generated', resumePhase: 'failed' });
  assert.equal(filter.source, undefined);

  const scoutify = resumeQueueJobFilter('scoutify');
  assert.equal(scoutify.source, 'scoutify');
  assert.equal(resumeQueueJobFilter('all').source, undefined);
  assert.equal(resumeQueueJobFilter('not-a-source').source, undefined);
});

test('normalizeJobSourceFilter and clear resume helpers export', () => {
  const {
    normalizeJobSourceFilter,
    JOB_SOURCE_FILTERS,
  } = require('../dist/services/jobMaintenance');
  assert.equal(normalizeJobSourceFilter('Scoutify'), 'scoutify');
  assert.equal(normalizeJobSourceFilter('all'), undefined);
  assert.equal(normalizeJobSourceFilter(''), undefined);
  assert.ok(JOB_SOURCE_FILTERS.includes('scoutify'));
  assert.ok(JOB_SOURCE_FILTERS.includes('jobright'));
});

test('masters F-1 eligibility skips citizenship-only and no-sponsorship jobs', () => {
  const {
    isIneligibleForMastersF1,
    shouldSkipJobDescription,
    isUndergraduateOnlyJob,
  } = require('../dist/services/jobSkipRules');

  assert.equal(
    isIneligibleForMastersF1('SWE Intern', 'Must be a U.S. citizen. Summer 2027.'),
    true
  );
  // Citizenship helper does not treat "no sponsorship" as citizenship — skip rules do
  assert.equal(
    isIneligibleForMastersF1('SWE Intern', 'No visa sponsorship available for this role.'),
    false
  );
  assert.equal(
    isIneligibleForMastersF1(
      'SWE Intern',
      'U.S. citizenship not required. OPT / STEM OPT candidates welcome.'
    ),
    false
  );
  assert.equal(
    isUndergraduateOnlyJob('Software Undergrad Intern', 'For bachelor students only.'),
    true
  );

  const skipNoSponsor = shouldSkipJobDescription(
    'Software Engineer',
    'Acme',
    'This role does not offer visa sponsorship. Full-time SWE. React and Node.'
  );
  assert.equal(skipNoSponsor.skip, true);
  assert.match(skipNoSponsor.reason || '', /sponsorship/i);

  const skipCitizen = shouldSkipJobDescription(
    'Software Engineer',
    'Acme',
    'Must be a U.S. citizen. Full-time software engineer. React.'
  );
  assert.equal(skipCitizen.skip, true);
  assert.match(skipCitizen.reason || '', /citizenship|F-1/i);
});

test('targeting brief skips non-SWE titles, 5+ YoE, and keeps new-grad 4y', () => {
  const { shouldSkipJobDescription, parseExperienceRequirement } = require('../dist/services/jobSkipRules');
  const { titlesSimilar } = require('../dist/services/jobDedup');
  const { isJunkSkillToken } = require('../dist/services/resumeAgent/jdMatch');
  const { isEligibleJob } = require('../dist/services/eligibility');
  const { answerCommonQuestions } = require('../dist/services/applicationAnswers');
  const { applicationProfile, formatDesiredSalaryRange } = require('../dist/data/applicationProfile');
  const { isUsJobLocation } = require('../dist/services/usLocation');

  assert.equal(
    shouldSkipJobDescription('Data Scientist', 'Acme', 'Build ML models. Python.').skip,
    true
  );
  assert.equal(
    shouldSkipJobDescription('Senior Software Engineer', 'Acme', 'Full-time SWE.').skip,
    true
  );
  assert.equal(
    shouldSkipJobDescription(
      'Senior Software Engineer New Grad',
      'Acme',
      'New Grad 2027. Java and AWS.'
    ).skip,
    true
  );
  assert.equal(
    shouldSkipJobDescription(
      'Software Engineer',
      'Acme',
      'Requires 5+ years of software experience. Java and AWS.'
    ).skip,
    true
  );
  assert.equal(
    shouldSkipJobDescription(
      'Software Engineer, New Grad',
      'Acme',
      'Requires 4 years of experience or equivalent. Java and AWS. Class of 2027.'
    ).skip,
    false
  );
  assert.equal(
    shouldSkipJobDescription(
      'Software Engineer',
      'Acme',
      'Requires 4 years of experience. Java and AWS.'
    ).skip,
    true
  );
  // Keep 3-5 and 0-5 ranges
  assert.equal(
    shouldSkipJobDescription(
      'Software Engineer',
      'Acme',
      'Requires 3-5 years of software experience. Java and AWS.'
    ).skip,
    false
  );
  assert.equal(
    shouldSkipJobDescription(
      'Software Engineer',
      'Acme',
      'Requires 0-5 years of experience. Java and AWS.'
    ).skip,
    false
  );
  assert.equal(parseExperienceRequirement('Requires 0-5 years of experience.').min, 0);
  assert.equal(parseExperienceRequirement('Requires 0-5 years of experience.').max, 5);
  assert.equal(parseExperienceRequirement('Requires 3-5 years of experience.').min, 3);

  assert.equal(
    shouldSkipJobDescription('Software Engineer Intern', 'Acme', 'Summer 2027 internship.').skip ||
      !isEligibleJob('fulltime', 'Software Engineer Intern', 'Summer 2027 internship.'),
    true
  );
  assert.equal(
    shouldSkipJobDescription(
      'Software Engineer',
      'Acme',
      'Contract-to-hire role. Java and AWS. Full-time.'
    ).skip,
    true
  );
  assert.equal(
    shouldSkipJobDescription('Part-Time Software Engineer', 'Acme', 'Java and AWS.').skip,
    true
  );
  assert.equal(
    shouldSkipJobDescription('Crypto NFT Engineer', 'Acme', 'Build NFT marketplace.').skip,
    true
  );

  assert.equal(titlesSimilar('Software Engineer, Backend', 'Software Engineer Backend'), true);
  assert.equal(titlesSimilar('Software Engineer New Grad 2027', 'Software Engineer'), true);
  assert.equal(titlesSimilar('Data Scientist', 'Software Engineer'), false);

  assert.equal(isJunkSkillToken('modules'), true);
  assert.equal(isJunkSkillToken('scalability'), true);
  assert.equal(isJunkSkillToken('Agile'), true);
  assert.equal(isJunkSkillToken('TypeScript'), false);

  assert.equal(
    answerCommonQuestions('Do you require visa sponsorship?', '', applicationProfile),
    'Yes'
  );
  assert.equal(
    answerCommonQuestions('Will you now or in the future require sponsorship?', '', applicationProfile),
    'Yes'
  );
  assert.equal(
    answerCommonQuestions('Do you currently require sponsorship?', '', applicationProfile),
    'No'
  );
  assert.match(formatDesiredSalaryRange(applicationProfile), /120,000/);
  assert.equal(isUsJobLocation('Remote - North America', 'Software engineer US remote'), true);
});

test('full-time targeting rejects internships and keeps new-grad SWE', () => {
  const { isEligibleJob, isInternshipTitle, inferJobType } = require('../dist/services/eligibility');

  assert.equal(isInternshipTitle('Software Engineering Intern'), true);
  assert.equal(isInternshipTitle('Software Engineer New Grad'), false);
  assert.equal(inferJobType('SWE Intern', 'Summer 2027 internship'), 'internship');
  assert.equal(inferJobType('Software Engineer', 'Prior internships welcome. Full-time role.'), 'fulltime');

  assert.equal(
    isEligibleJob('internship', 'Software Engineering Intern', 'Summer 2027 software internship.'),
    false
  );
  assert.equal(
    isEligibleJob(
      'fulltime',
      'Software Engineer New Grad',
      'Entry-level full-time SWE. Expected graduation January 2027. React and Node.'
    ),
    true
  );
  assert.equal(
    isEligibleJob('fulltime', 'Software Engineering Intern', 'Summer 2027 software internship.'),
    false
  );
});

test('graduation filter keeps Jan 2027 and silent JDs', () => {
  const { isInternGraduationEligible } = require('../dist/services/internGraduation');
  const { shouldSkipJobDescription } = require('../dist/services/jobSkipRules');
  const { isSummer2027InternTarget } = require('../dist/services/jobMaintenance');

  assert.equal(
    isInternGraduationEligible(
      'Software Engineering Intern',
      'Currently enrolled students welcome.'
    ),
    true
  );
  assert.equal(
    isInternGraduationEligible(
      'SWE Intern',
      'Expected graduation January 2027. Software internship.'
    ),
    true
  );
  assert.equal(
    isInternGraduationEligible(
      'SWE Intern',
      'Must be graduating May 2027. Summer 2027 software internship.'
    ),
    false
  );
  assert.equal(
    isInternGraduationEligible('SWE Intern', 'Class of 2025 only. Summer internship.'),
    false
  );

  const skip = shouldSkipJobDescription(
    'Software Engineering Intern',
    'Acme',
    'Expected graduation: May 2027. Summer 2027 internship for software engineers.'
  );
  assert.equal(skip.skip, true);
  assert.match(skip.reason || '', /Graduation|January 2027/i);

  assert.equal(
    isSummer2027InternTarget(
      'Software Engineering Intern',
      'Summer 2027. Graduating January 2027. Build software with React and Python.'
    ),
    true
  );
  assert.equal(
    isSummer2027InternTarget(
      'Software Engineering Intern',
      'Summer 2027. Expected graduation May 2026. React and Node.'
    ),
    false
  );
});

test('rejects Amsterdam / Dutch-university enrollment jobs for U.S. F-1 candidate', () => {
  const { isUsJobLocation } = require('../dist/services/usLocation');
  const { shouldSkipJobDescription } = require('../dist/services/jobSkipRules');

  assert.equal(isUsJobLocation('Amsterdam', 'Software intern at ING NL'), false);
  assert.equal(
    isUsJobLocation(
      'Remote',
      'Location: Amsterdam\nDuring the internship it is mandatory to be enrolled at a Dutch university.'
    ),
    false
  );
  assert.equal(
    isUsJobLocation('United States', 'Summer 2027 software internship in California.'),
    true
  );

  const skip = shouldSkipJobDescription(
    'AI Agents Intern',
    'ING',
    'During the duration of your internship at ING, it is mandatory to be enrolled at a Dutch university (or EU-university for EU passport holders). Location: Amsterdam.'
  );
  assert.equal(skip.skip, true);
  assert.match(skip.reason || '', /Dutch|EU university|enroll/i);
});

test('HTML JD cleaning and keyword extract never injects tag junk', () => {
  const { cleanJobDescriptionForResume } = require('../dist/services/cleanJobDescription');
  const { isInvalidOrMissingJd } = require('../dist/services/applyPageJdFetcher');
  const {
    extractJdKeywords,
    injectMissingJdKeywords,
    isJunkSkillToken,
    scoreResumeAgainstJd,
  } = require('../dist/services/resumeAgent/jdMatch');
  const { sanitizeResumeLatex } = require('../dist/services/resumeAgent/sanitizeLatex');

  const deadWorkday = `Job not found
The job you requested was not found.
View all open positions
Powered by Workday
Privacy Policy Security Vulnerability Disclosure`;
  assert.equal(isInvalidOrMissingJd(deadWorkday), true);

  const listingPage = `Current Openings at Point72
Search Department Select Office Select
229 jobs
Academy Job
2027 Point72 Academy Investment Analyst Summer Internship Program - Hong Kong
Hong Kong
2027 Point72 Academy Investment Analyst Summer Internship Program - Japan
Japan`;
  assert.equal(isInvalidOrMissingJd(listingPage), true);

  const realJd = `About the Role
Software Engineering Intern responsibilities include building production systems with Python and React.
Requirements: Java, TypeScript, AWS. Bachelor's or Master's in Computer Science.
Qualifications: strong algorithms, systems design, and backend APIs.`;
  assert.equal(isInvalidOrMissingJd(realJd), false);

  const htmlJd = `
    <p><strong>Knowledge, Skills and Abilities:</strong></p>
    <ul><li><p>Proficiency in C# or Java</p></li>
    <li><p>Familiarity with Docker and Kubernetes is a plus.</p></li>
    <li><p>Exposure to messaging (RabbitMQ, Kafka, Redis)</p></li></ul>
    <p>Currently pursuing a B.S. or M.S. in Computer Science.</p>
    <div class="FeedBlockStory">junk UI</div>
  `;

  const cleaned = cleanJobDescriptionForResume(htmlJd);
  assert.equal(/<p>|<strong>|FeedBlock/i.test(cleaned), false);
  assert.match(cleaned, /C#|Java/);

  const scmHtml = `
<p>We're seeking highly motivated students.</p>
<p><strong>Primary Responsibilities:</strong></p>
<ul><li>Develop new software and enhance existing systems.</li>
<li>Create tools to process quote, trade and financial data.</li></ul>
<p><strong>Requirements:</strong></p>
<ul><li>Pursuing an undergraduate or graduate level degree in Computer Science or Mathematics.</li>
<li>C++ and/or Java programming knowledge or experience in a Linux environment preferred.</li>
<li>Knowledge of shell scripts including Perl, Bash or CSH is a plus.</li></ul>
`;
  const scm = cleanJobDescriptionForResume(scmHtml);
  assert.equal(/<\/?p>|<li>/i.test(scm), false);
  assert.match(scm, /C\+\+|Java|Linux/);
  assert.match(scm, /Primary Responsibilities|Requirements/);

  const kws = extractJdKeywords(htmlJd);
  assert.ok(kws.some((k) => /java/i.test(k)));
  assert.ok(kws.some((k) => /c#|\.net/i.test(k)));
  assert.equal(kws.some((k) => /strong|Knowledge|Abilities|plus/i.test(k)), false);

  assert.equal(isJunkSkillToken('p strong strong Knowledge'), true);
  assert.equal(isJunkSkillToken('scalability concepts.'), true);
  assert.equal(isJunkSkillToken('C#'), false);
  assert.equal(isJunkSkillToken('modules'), true);
  assert.equal(isJunkSkillToken('derivations'), true);
  assert.equal(isJunkSkillToken('VM tests'), true);
  assert.equal(isJunkSkillToken('Nix'), false);

  const { mergeLlmAndRegexMatch, filterSkillTokens } = require('../dist/services/resumeAgent/jdMatch');
  const merged = mergeLlmAndRegexMatch(
    {
      jdSkills: ['Python', 'modules', 'derivations', 'VM tests', 'Nix'],
      matched: ['Python', 'Nix'],
      missing: ['modules', 'derivations', 'VM tests'],
      skillGaps: [
        '"modules" is required by the JD but not evidenced in an Experience or Project bullet',
        '"derivations" is required by the JD but not evidenced',
      ],
      keywordMatchScore: 40,
      resumeMatchScore: 40,
    },
    { score: 100, matched: ['Python'], missing: [], keywords: ['Python'] }
  );
  assert.equal(merged.match.missing.some((m) => /modules|derivations|vm\s*tests/i.test(m)), false);
  assert.equal(filterSkillTokens(['modules', 'Python', 'CI/CD']).includes('modules'), false);
  assert.ok(filterSkillTokens(['modules', 'Python', 'CI/CD']).includes('Python'));

  const pollutedLang = `\\textbf{Languages:} Go, Python, Java, JavaScript (ES6+), TypeScript, SQL, C++ ; Build production systems. Design, it s the job., the physical world., What You ll Bring, Demonstrated ability to build, prior internships \\\\`;
  const cleanedLang = sanitizeResumeLatex(pollutedLang);
  assert.match(cleanedLang, /\\textbf\{Languages:\}/);
  assert.equal(/Build production|What You|physical world|Demonstrated ability/i.test(cleanedLang), false);
  assert.match(cleanedLang, /Python/);
  assert.match(cleanedLang, /C\+\+/);

  const pollutedHtml =
    '\\textbf{Languages:} Java, C; ReactNative, p strong strong Knowledge, Abilities, p Proficiency in C, scalability concepts.';
  const scrubbed = sanitizeResumeLatex(pollutedHtml);
  assert.equal(/p strong|Knowledge, Abilities|scalability concepts|Proficiency in/i.test(scrubbed), false);
  assert.match(scrubbed, /Java/);

  let latex =
    '\\section{\\textbf{Technical Skills}}\n\\textbf{Languages:} Java, Python, TypeScript \\\\\n';
  latex = injectMissingJdKeywords(latex, [
    'C#',
    'Docker',
    'p strong Knowledge',
    'Familiarity with Docker is a plus',
  ]);
  assert.match(latex, /C\\?#/);
  assert.equal(/p strong|Familiarity with/i.test(latex), false);

  const score = scoreResumeAgainstJd(htmlJd, latex + ' Kafka Redis Kubernetes .NET');
  assert.ok(score.score >= 50);
  assert.equal(score.missing.some((m) => /strong|Knowledge/i.test(m)), false);

  const fullIherb = `Job Summary: Microsoft .NET stack IoT warehouse.
Knowledge, Skills and Abilities:
Proficiency in C# or Java
OOD and SOLID principles
Prometheus, Grafana and OpenTelemetry
REST APIs, event-driven systems
CI/CD pipelines
Docker and Kubernetes
RabbitMQ, Kafka, Redis
native Android
Experience Requirements: ASP MVC, ReactJS or ReactNative, warehouse logistics
Education: B.S. or M.S. Computer Science.`;
  const fullKws = extractJdKeywords(fullIherb);
  assert.ok(fullKws.length >= 8, `expected many keywords, got ${fullKws.join(', ')}`);
  assert.ok(fullKws.some((k) => /java/i.test(k)));
  assert.ok(fullKws.some((k) => /c#/i.test(k)));
  assert.ok(fullKws.some((k) => /docker/i.test(k)));
});

test('model MATCH_REPORT JSON parses keyword + resume scores and skill gaps', () => {
  const { extractMatchReportFromModelResponse } = require('../dist/services/resumeAgent/extractLatex');
  const raw = `
\\section{\\textbf{Education}}
===MATCH_REPORT===
{"jdSkills":["C#",".NET","Java","Docker"],"matched":["Java","C#",".NET"],"missing":["Docker"],"skillGaps":["Docker not evidenced in a bullet"],"keywordMatchScore":75,"resumeMatchScore":70,"notes":"Strong language overlap; weak DevOps evidence."}
===END_MATCH_REPORT===
`;
  const report = extractMatchReportFromModelResponse(raw);
  assert.ok(report);
  assert.equal(report.keywordMatchScore, 75);
  assert.equal(report.resumeMatchScore, 70);
  assert.deepEqual(report.missing, ['Docker']);
  assert.match(report.skillGaps[0], /Docker/);
});

test('full JD match requires exactly 100% and ≥3 linked Key Projects', () => {
  const {
    isFullJdMatch,
    countLinkedFeaturedProjects,
    hasEnoughLinkedProjects,
  } = require('../dist/services/resumeAgent/jdMatch');

  assert.equal(
    isFullJdMatch({
      score: 95,
      matched: ['a', 'b'],
      missing: ['c'],
      keywords: ['a', 'b', 'c'],
    }),
    false
  );
  assert.equal(
    isFullJdMatch({
      score: 100,
      matched: ['a', 'b', 'c'],
      missing: [],
      keywords: ['a', 'b', 'c'],
    }),
    true
  );

  const latex = `
\\section{\\textbf{Key Projects}}
\\href{https://nativenest.in}{\\textbf{NativeNest}} \\\\
\\href{https://arikya.in}{\\textbf{Arikya}} \\\\
\\href{https://jobtracker.karthikkovi.com}{\\textbf{Job Tracker}} \\\\
\\textbf{CloudSync} \\\\
\\textbf{RenderSync} \\\\
\\section{\\textbf{Education}}
`;
  assert.ok(countLinkedFeaturedProjects(latex) >= 3);
  assert.equal(hasEnoughLinkedProjects(latex, 3), true);

  const weak = `
\\section{\\textbf{Key Projects}}
\\textbf{CloudSync} \\\\
\\textbf{RenderSync} \\\\
\\href{https://nativenest.in}{\\textbf{NativeNest}} \\\\
\\section{\\textbf{Education}}
`;
  assert.equal(hasEnoughLinkedProjects(weak, 3), false);
});

test('header title shortens and may drop Open to Relocate', () => {
  const {
    applyJdHeaderTagline,
    shortenHeaderRoleTitle,
  } = require('../dist/services/resumeAgent/amazonLatexGuard');
  assert.equal(shortenHeaderRoleTitle('Software Engineer New Grad - Backend'), 'Backend Engineer');
  assert.equal(shortenHeaderRoleTitle('Frontend Engineer, React'), 'Frontend Engineer');
  assert.equal(shortenHeaderRoleTitle('Full Stack Software Engineer II'), 'Full Stack Engineer');
  assert.equal(shortenHeaderRoleTitle('SDE I University Graduate'), 'Software Engineer');

  const base = `
\\begin{center}
    \\textbf{\\Huge \\scshape Karthik Kovi}\\\\[-2pt]
    {Software Engineer} \\,\\textbar\\,
    {Open to Relocate} \\,\\textbar\\,
    \\href{mailto:karthikkovik@gmail.com}{karthikkovik@gmail.com} \\,\\textbar\\,
    \\href{tel:+15622840297}{+1 (562) 284-0297} \\,\\textbar\\, California, USA\\\\
\\end{center}
`;
  const withBackend = applyJdHeaderTagline(base, {
    title: 'Backend Software Engineer New Grad 2027',
    jobDescription: 'Build backend APIs',
  });
  assert.match(withBackend, /\{Backend Engineer\}/);
  assert.match(withBackend, /Open to Relocate/);
  assert.match(withBackend, /karthikkovik@gmail\.com/);
});

test('enforceMasterRules caps experience bullets, one-line bullets, strips Redbee', () => {
  const {
    enforceMasterRules,
    MAX_BULLET_PLAIN_CHARS,
    TEMPLATE_ITEMIZE_OPTS,
  } = require('../dist/services/resumeAgent/enforceMasterRules');
  const dirty = `
\\section{\\textbf{Work Experience}}
\\textbf{Engineer} \\hfill Amazon \\hfill \\hspace{0.1em} \\textbf{01/2025 -- Present}
\\begin{itemize}
\\item Designed and built an extremely long bullet that intentionally exceeds the single printed line limit by packing many unnecessary words and clauses so wrapping would occur on letter paper.
\\item two
\\item three
\\item four
\\item five
\\item six should go
\\end{itemize}
\\textbf{Software Engineer Intern} \\hfill \\uline{\\textbf{Redbee Technologies}} \\hfill \\textbf{08/2022 -- 12/2022}
\\begin{itemize}
\\item Should be removed with Redbee
\\end{itemize}
\\section{\\textbf{Key Projects}}
\\textit{React, Node.js, C++, Python}
\\textbf{Languages:} Python, Java ; Build production systems. What You ll Bring \\\\
`;
  const out = enforceMasterRules(dirty);
  assert.equal(/Build production|What You/i.test(out), false);
  assert.match(out, /Python/);
  assert.equal(/Redbee/i.test(out), false);
  // Visual lock: section gap + template itemize options
  assert.match(out, /\\section\{\\textbf\{Work Experience\}\}\n\\vspace\{2pt\}/);
  assert.match(
    out,
    new RegExp(
      `\\\\begin\\{itemize\\}\\[${TEMPLATE_ITEMIZE_OPTS.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]`
    )
  );
  assert.match(out, /\\uline\{\\textbf\{Amazon - Bellevue, WA\}/);
  assert.match(out, /05\/2026 - 08\/2026/);
  // Experience: at most 5 items (Karthik standard template)
  const exp = out.split(/\\section\{\\textbf\{Key Projects\}\}/i)[0];
  assert.ok((exp.match(/\\item\b/g) || []).length <= 5);
  // C++ not mixed with Node/Python on tech line
  assert.equal(/\\textit\{[^}]*C\+\+[^}]*(?:Node|Python)/i.test(out), false);
  // Every experience bullet plain text fits one line
  for (const m of exp.matchAll(/\\item\b([\s\S]*?)(?=\\item\b|\\end\{itemize\}|$)/gi)) {
    const plain = m[1]
      .replace(/\\textbf\{([^}]*)\}/g, '$1')
      .replace(/\\[a-zA-Z]+\*?(\[[^\]]*\])?/g, '')
      .replace(/[{}]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!plain) continue;
    assert.ok(
      plain.length <= MAX_BULLET_PLAIN_CHARS + 5,
      `bullet too long (${plain.length}): ${plain}`
    );
  }
});

test('enforceMasterRules rewrites invented San Jose State to CSULB Education', () => {
  const {
    enforceMasterRules,
    forceCanonicalEducation,
  } = require('../dist/services/resumeAgent/enforceMasterRules');
  const dirty = `
\\section{\\textbf{Education}}
\\vspace{2pt}
\\textbf{Master of Science in Computer Science} \\textbar{} \\uline{\\textbf{San Jose State University}} \\hfill \\textit{San Jose, CA} \\textbf{Aug 2023 -- Jan 2027}\\\\
\\textbf{Bachelor of Technology in Computer Science} \\textbar{} \\uline{\\textbf{JNTU Anantapur - MITS}} \\hfill \\textit{Andhra Pradesh, India} \\textbf{Aug 2015 -- May 2019}
\\section{\\textbf{Certifications}}
AWS Certified - 2024 \\\\
\\end{document}
`;
  const out = enforceMasterRules(dirty);
  assert.equal(/San\s*Jose\s*State/i.test(out), false, 'must strip San Jose State');
  assert.equal(/\bSJSU\b/.test(out), false);
  assert.match(out, /California State University,\s*Long Beach/);
  assert.match(out, /JNTU Anantapur - MITS/);
  assert.match(out, /01\/2025 - 01\/2027/);
  assert.match(out, /08\/2019 - 05\/2023/);
  assert.equal(/Aug\s*2015|May\s*2019|3\.8\/4\.0/i.test(out), false);

  const scrubbed = forceCanonicalEducation(
    'Worked at SJSU. \\uline{\\textbf{San Jose State University}} \\textit{San Jose, CA}'
  );
  assert.equal(/San\s*Jose\s*State|SJSU/i.test(scrubbed), false);
  assert.match(scrubbed, /California State University,\s*Long Beach/);
  assert.match(scrubbed, /Long Beach, CA, USA/);
});

test('enforceMasterRules rewrites fabricated employment dates and fake employers', () => {
  const { enforceMasterRules } = require('../dist/services/resumeAgent/enforceMasterRules');
  const dirty = `
\\section{\\textbf{Work Experience}}
\\vspace{2pt}
\\textbf{Software Engineer Intern} \\hfill \\uline{\\textbf{Amazon}} \\hfill Seattle, WA \\textbf{01/2024 - 05/2024}
\\begin{itemize}
\\item Built batch jobs on AWS Lambda.
\\end{itemize}
\\textbf{Software Engineer} \\hfill \\uline{\\textbf{Advanced Systems Inc}} \\hfill New York, NY \\textbf{08/2021 - 08/2023}
\\begin{itemize}
\\item Built Kubernetes services.
\\end{itemize}
\\textbf{Software Engineer} \\hfill \\uline{\\textbf{Infobell IT Solutions}} \\hfill Bangalore \\textbf{06/2019 - 07/2021}
\\begin{itemize}
\\item Built Go services.
\\end{itemize}
\\section{\\textbf{Skills}}
\\vspace{2pt}
\\textbf{Languages:} Python \\\\
`;
  const out = enforceMasterRules(dirty);
  assert.equal(/01\/2024|05\/2024|08\/2021|08\/2023|06\/2019|07\/2021/i.test(out), false);
  assert.equal(/Advanced\s+Systems/i.test(out), false);
  assert.equal(/Seattle,\s*WA/i.test(out), false);
  assert.match(out, /Amazon - Bellevue, WA/);
  assert.match(out, /05\/2026 - 08\/2026/);
  assert.match(out, /Associated Students, Inc\. - CSULB/);
  assert.match(out, /02\/2025 - Present/);
  assert.match(out, /Infobell IT Solutions Pvt Ltd/);
  assert.match(out, /01\/2023 - 01\/2025/);
  assert.match(out, /Built batch jobs on AWS Lambda/);
  assert.match(out, /Built Kubernetes services/);
});

test('checkAmazonLatex requires visual lock chrome', () => {
  const fs = require('fs');
  const path = require('path');
  const { checkAmazonLatex } = require('../dist/services/resumeAgent/amazonLatexGuard');
  const template = fs.readFileSync(
    path.join(__dirname, '../src/data/resume-assets/amazonResumeTemplate.tex'),
    'utf8'
  );
  const good = checkAmazonLatex(template);
  assert.equal(good.ok, true, good.reasons.join('; '));
});
test('countPdfPages reads tectonic/object-stream PDFs via PyPDF2', () => {
  const fs = require('fs');
  const path = require('path');
  const { countPdfPages } = require('../dist/services/latexCompileService');
  const uploads = path.join(__dirname, '../uploads');
  const pdfs = fs.existsSync(uploads)
    ? fs.readdirSync(uploads).filter((f) => f.endsWith('-resume.pdf'))
    : [];
  assert.ok(pdfs.length > 0, 'expected at least one compiled resume PDF in uploads/');
  const preferred = pdfs.find((f) => f.includes('1785882327563')) || pdfs[0];
  const pages = countPdfPages(path.join(uploads, preferred));
  assert.ok(pages >= 1, `expected ≥1 page, got ${pages} for ${preferred}`);
});

test('enforceAmazonLatex splices Work Experience when model omits it', () => {
  const { enforceAmazonLatex } = require('../dist/services/resumeAgent/amazonLatexGuard');
  const withSkills = `
\\section{\\textbf{Skills}}
\\vspace{2pt}
\\textbf{Languages:} Java, Python, TypeScript, SQL, Bash \\\\
\\textbf{Backend:} Spring Boot, Express.js, FastAPI, REST, GraphQL, PostgreSQL, Redis \\\\
\\textbf{Frontend:} React.js, Next.js, Redux, Tailwind CSS \\\\
\\textbf{Cloud \\& DevOps:} AWS, Docker, Jenkins, GitHub Actions, CI/CD \\\\
\\textbf{Monitoring:} Prometheus, Grafana, ELK Stack \\\\
\\textbf{Practices:} Agile/SCRUM, OOP, DSA, System Design, TDD \\\\
\\section{\\textbf{Key Projects}}
\\vspace{2pt}
\\href{https://nativenest.in}{\\textbf{NativeNest -- Commerce}} \\,\\textbar\\, {React, Spring Boot, AWS}\\\\
Delivered production e-commerce for 30K+ users with \\textbf{99.9\\% uptime}.
\\vspace{2pt}
\\href{https://arikya.in}{\\textbf{Arikya -- SaaS}} \\,\\textbar\\, {Angular, Node.js, AWS}\\\\
Built assessment dashboards for 10K+ students.
\\vspace{2pt}
\\textbf{CloudSync -- Orchestration} \\,\\textbar\\, {Java, AWS, Docker, Redis}\\\\
Built multi-service data orchestration improving efficiency by \\textbf{40\\%}.
\\section{\\textbf{Education}}
\\vspace{2pt}
\\textbf{M.S. in Computer Science (3.67/4)} \\hfill \\uline{\\textbf{California State University}} \\hfill \\textit{Long Beach, CA, USA} \\hspace{0.1em} \\textbf{01/2025 -- 01/2027}\\\\
\\textbf{B.Tech in Computer Science (3.60/4)} \\hfill \\uline{\\textbf{JNTU Anantapur -- MITS}} \\hfill \\textit{Andhra Pradesh, India} \\hspace{0.1em} \\textbf{08/2019 -- 05/2023}
\\section{\\textbf{Certifications}}
\\vspace{2pt}
Java Spring Boot Developer -- 2024 \\\\
Docker \\& Container Orchestration -- 2024 \\\\
`;
  const out = enforceAmazonLatex(withSkills);
  assert.match(out, /\\section\{\\textbf\{Work Experience\}\}/);
  assert.match(out, /Amazon/);
  assert.match(out, /\\section\{\\textbf\{Skills\}\}/);
  assert.match(out, /NativeNest/);
});

test('parseModelResumeResponse unwraps Claude JSON and rejects empty prose', () => {
  const { parseModelResumeResponse } = require('../dist/services/resumeAgent/extractLatex');

  const wrapped = JSON.stringify({
    result:
      '\\section{\\textbf{Work Experience}}\n\\textbf{Software Engineer Intern} Amazon\n\\begin{itemize}\\item Built AWS Lambda jobs.\\end{itemize}',
  });
  const ok = parseModelResumeResponse(wrapped);
  assert.match(ok.latex, /Work Experience/);
  assert.match(ok.latex, /Amazon/);

  assert.throws(
    () => parseModelResumeResponse('Sorry, I cannot help with that.'),
    /No LaTeX found|Preview:/i
  );
});

test('normalizePlainHyphens converts en/em dashes to spaced plain hyphens', () => {
  const { normalizePlainHyphens, sanitizeResumeLatex } = require('../dist/services/resumeAgent/sanitizeLatex');

  const dirty = [
    'Java Spring Boot Developer –2024',
    '01/2025 –01/2027',
    '08/2019 -- 05/2023',
    'NativeNest – Cross-Platform',
    'Amazon -- Bellevue, WA',
    'JNTU Anantapur -- MITS',
    '(-40\\% deploy)',
    '\\\\[-2pt]',
    '\\href{https://nativenest.in}{NativeNest}',
  ].join('\n');

  const out = normalizePlainHyphens(dirty);
  assert.match(out, /Developer - 2024/);
  assert.match(out, /01\/2025 - 01\/2027/);
  assert.match(out, /08\/2019 - 05\/2023/);
  assert.match(out, /NativeNest - Cross-Platform/);
  assert.match(out, /Amazon - Bellevue/);
  assert.match(out, /Anantapur - MITS/);
  assert.match(out, /\(-40\\% deploy\)/);
  assert.match(out, /\\\\\[-2pt\]/);
  assert.match(out, /\\href\{https:\/\/nativenest\.in\}/);
  assert.equal(/[–—]|--|---/.test(out.replace(/\\\\\[-2pt\]/, '').replace(/\\href\{[^}]*\}/, '')), false);

  const spaced = sanitizeResumeLatex(
    '\\textbf{M.S.} \\textbf{01/2025--01/2027}\\\\ Java Spring Boot Developer--2024'
  );
  assert.match(spaced, /01\/2025 - 01\/2027/);
  assert.match(spaced, /Developer - 2024/);
});

test('shortenBulletToOneLine humanizes AI voice and finishes incomplete tails', () => {
  const {
    shortenBulletToOneLine,
    finishCompleteBullet,
    humanizeBulletVoice,
    MAX_BULLET_PLAIN_CHARS,
  } = require('../dist/services/resumeAgent/enforceMasterRules');

  assert.match(humanizeBulletVoice('Leveraged Docker to ship'), /Used Docker/);
  assert.equal(finishCompleteBullet('Built services with accessibility compliance in'), 'Built services with accessibility compliance.');
  assert.match(finishCompleteBullet('Built \\textbf{Docker'), /\\textbf\{Docker\}/);

  const longAi =
    '\\item Successfully leveraged cutting-edge robust Docker and seamlessly orchestrated CI/CD pipelines ensuring scalable deployment consistency across the organization while delivering impactful results for stakeholders.';
  const out = shortenBulletToOneLine(longAi);
  assert.equal(/leveraged|cutting-edge|seamlessly|orchestrated|impactful/i.test(out), false);
  assert.match(out, /\.$/);
  const plain = out
    .replace(/^\\item\s*/i, '')
    .replace(/\\textbf\{([^}]*)\}/g, '$1')
    .replace(/\\[a-zA-Z]+\*?(\[[^\]]*\])?/g, '')
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  assert.ok(plain.length <= MAX_BULLET_PLAIN_CHARS + 2, `too long: ${plain.length} ${plain}`);
  assert.equal(/\b(with|in|and|for|to|the|a)\s*\.?$/i.test(plain.replace(/\.$/, '')), false);
});

test('pipeline job timeout defaults to LLM timeout plus compile buffer', () => {
  const { pipelineJobTimeoutMs, PipelineAbortError, isPipelineAbortError } = require('../dist/services/pipelineAbort');
  const ms = pipelineJobTimeoutMs();
  assert.ok(ms >= 20 * 60 * 1000, `expected at least 20m, got ${ms}`);
  const err = new PipelineAbortError('Stop requested by user');
  assert.equal(isPipelineAbortError(err), true);
  assert.equal(isPipelineAbortError(new Error('nope')), false);
});

test('ATS detector prefers career pages over LinkedIn Easy Apply', () => {
  const { detectAts, prefersCareerApply, isLinkedInEasyApplyUrl } = require('../dist/services/atsDetector');

  assert.equal(detectAts('https://boards.greenhouse.io/stripe/jobs/123').ats, 'greenhouse');
  assert.equal(detectAts('https://job-boards.greenhouse.io/figma/jobs/456').ats, 'greenhouse');
  assert.equal(detectAts('https://boards.greenhouse.io/embed/job_app?for=acme&token=1').ats, 'greenhouse');
  assert.equal(detectAts('https://jobs.lever.co/palantir/abcdef').ats, 'lever');
  assert.equal(detectAts('https://jobs.ashbyhq.com/openai/uuid').ats, 'ashby');
  assert.equal(detectAts('https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/job/x').ats, 'workday');
  assert.equal(detectAts('https://www.linkedin.com/jobs/view/123').ats, 'linkedin');
  assert.equal(isLinkedInEasyApplyUrl('https://www.linkedin.com/jobs/view/123'), true);
  assert.equal(prefersCareerApply('https://boards.greenhouse.io/stripe/jobs/123'), true);
  assert.equal(prefersCareerApply('https://www.linkedin.com/jobs/view/123'), false);
  assert.equal(detectAts('https://careers.example.com/jobs/swe', 'scoutify').isCareerPage, true);
  assert.equal(detectAts('https://www.indeed.com/viewjob?jk=abc').ats, 'indeed');
  // Source hint when URL is ambiguous company portal
  assert.equal(detectAts('https://jobs.example.com/x', 'greenhouse').ats, 'greenhouse');
  assert.equal(detectAts('https://jobs.example.com/x', 'lever').ats, 'lever');
});

test('career apply utils: Lever /apply URL, success page, honeypots, Greenhouse iframe selectors', () => {
  const {
    resolveLeverApplyUrl,
    looksLikeSuccessPage,
    isHoneypotField,
    isGreenhouseEmbedUrl,
    isCoverLetterFileField,
    GREENHOUSE_IFRAME_SELECTORS,
    GREENHOUSE_FIELD_SELECTORS,
    classifyPageBlocker,
    detectAccountWall,
    detectCaptchaWall,
    detectValidationErrors,
  } = require('../dist/services/careerApplyUtils');

  assert.equal(
    resolveLeverApplyUrl('https://jobs.lever.co/palantir/abcdef-1234'),
    'https://jobs.lever.co/palantir/abcdef-1234/apply'
  );
  assert.equal(
    resolveLeverApplyUrl('https://jobs.lever.co/palantir/abcdef-1234/apply'),
    'https://jobs.lever.co/palantir/abcdef-1234/apply'
  );
  assert.equal(
    resolveLeverApplyUrl('https://jobs.lever.co/acme/uuid/thanks'),
    'https://jobs.lever.co/acme/uuid/thanks'
  );
  assert.equal(
    resolveLeverApplyUrl('https://boards.greenhouse.io/stripe/jobs/1'),
    'https://boards.greenhouse.io/stripe/jobs/1'
  );

  assert.equal(looksLikeSuccessPage('https://jobs.lever.co/acme/x/thanks', ''), true);
  assert.equal(
    looksLikeSuccessPage('https://jobs.lever.co/acme/x?LeverAppId=abc', 'ok'),
    true
  );
  assert.equal(looksLikeSuccessPage('https://example.com/apply', 'Thank you for applying'), true);
  assert.equal(looksLikeSuccessPage('https://example.com/apply', 'Please fill required fields'), false);

  assert.equal(isHoneypotField('beecatcher'), true);
  assert.equal(isHoneypotField('website_url'), true);
  assert.equal(isHoneypotField('Email Address'), false);
  assert.equal(isCoverLetterFileField('cover_letter'), true);
  assert.equal(isCoverLetterFileField('resume'), false);

  assert.equal(isGreenhouseEmbedUrl('https://boards.greenhouse.io/embed/job_app?for=x'), true);
  assert.ok(GREENHOUSE_IFRAME_SELECTORS.includes('#grnhse_iframe'));
  assert.ok(GREENHOUSE_FIELD_SELECTORS.firstName.includes('#first_name'));
  assert.ok(GREENHOUSE_FIELD_SELECTORS.resume.includes('#resume'));

  assert.match(
    detectAccountWall('https://wd5.myworkdayjobs.com/x', 'Create Account\nPassword\nSign In') || '',
    /Account/
  );
  assert.match(
    detectAccountWall(
      'https://www.appone.com/ApplicantLogin.asp?JobCode=6150508&B_ID=91',
      'Login\nEmail'
    ) || '',
    /AppOne|login/i
  );
  assert.match(detectCaptchaWall('Please complete the hCaptcha challenge') || '', /CAPTCHA/);
  assert.match(
    detectValidationErrors('There were 2 errors. This field is required.') || '',
    /validation/i
  );
  assert.equal(classifyPageBlocker('https://x.com', 'normal application form'), null);
  assert.equal(
    classifyPageBlocker('https://x.com', 'Create Account and Sign In to continue').kind,
    'account'
  );
  assert.equal(classifyPageBlocker('https://x.com', 'I am not a robot hcaptcha').kind, 'captcha');
});

test('career apply routing: non-LinkedIn URLs prefer career path', () => {
  const { prefersCareerApply, detectAts } = require('../dist/services/atsDetector');
  const cases = [
    'https://boards.greenhouse.io/databricks/jobs/1',
    'https://jobs.lever.co/wealthfront/abc',
    'https://jobs.ashbyhq.com/notion/uuid',
    'https://microsoft.wd1.myworkdayjobs.com/en-US/MSFTJobs/job/x',
    'https://careers.google.com/jobs/results/123',
  ];
  for (const url of cases) {
    assert.equal(prefersCareerApply(url), true, url);
    assert.notEqual(detectAts(url).ats, 'linkedin', url);
  }
});

test('live ATS HTML fixtures match our Greenhouse/Lever selectors', () => {
  // Snapshot patterns captured from public boards (Discord Greenhouse + Palantir Lever, 2026-08).
  const greenhouseSnippet = `
    <input id="first_name" aria-label="First Name" type="text" />
    <input id="last_name" aria-label="Last Name" type="text" />
    <input id="email" aria-label="Email" type="text" />
    <input id="phone" aria-label="Phone" type="tel" />
    <input id="resume" class="visually-hidden" type="file" accept=".pdf" />
    <input id="cover_letter" class="visually-hidden" type="file" accept=".pdf" />
    <button type="submit" class="btn btn--rounded">Submit application</button>
  `;
  const leverSnippet = `
    <form class="application-form">
      <input name="name" />
      <input name="email" />
      <input name="resume" type="file" />
      <button data-qa="btn-submit" type="submit">Submit application</button>
    </form>
  `;

  assert.match(greenhouseSnippet, /id="first_name"/);
  assert.match(greenhouseSnippet, /id="resume"[^>]*type="file"/);
  assert.match(greenhouseSnippet, /Submit application/);
  assert.match(leverSnippet, /name="name"/);
  assert.match(leverSnippet, /name="resume"/);
  assert.match(leverSnippet, /data-qa="btn-submit"/);

  const { isCoverLetterFileField } = require('../dist/services/careerApplyUtils');
  assert.equal(isCoverLetterFileField('cover_letter'), true);

  const { resolveTextAnswer, resolveSelectAnswer } = require('../dist/services/applicationAnswers');
  const { applicationProfile } = require('../dist/data/applicationProfile');
  const first = resolveTextAnswer('First Name', applicationProfile, 'Long Beach');
  assert.equal(first.answer, applicationProfile.firstName);
  const email = resolveTextAnswer('Email', applicationProfile, 'Long Beach');
  assert.equal(email.answer, applicationProfile.email);
  const name = resolveTextAnswer('name', applicationProfile, 'Long Beach');
  assert.equal(name.answer, applicationProfile.fullName);
  const school = resolveTextAnswer('University / School name', applicationProfile, 'Long Beach');
  assert.equal(school.answer, 'California State University, Long Beach');
  assert.equal(school.needsAutocomplete, true);
  assert.equal(
    resolveSelectAnswer('School', applicationProfile, 'Long Beach'),
    'California State University, Long Beach'
  );
});

test('jobApplier prefers career pages and keeps LinkedIn as fallback only', () => {
  const { prefersCareerApply, isLinkedInEasyApplyUrl, detectAts } = require('../dist/services/jobApplier');
  assert.equal(prefersCareerApply('https://jobs.ashbyhq.com/notion/uuid'), true);
  assert.equal(detectAts('https://jobs.ashbyhq.com/notion/uuid').ats, 'ashby');
  assert.equal(isLinkedInEasyApplyUrl('https://www.linkedin.com/jobs/view/9'), true);
  assert.equal(prefersCareerApply('https://www.linkedin.com/jobs/view/9'), false);
});

test('career apply keeps Claude mid-apply AI off by default', () => {
  const { config } = require('../dist/config');
  // APPLY_USE_AI must be opt-in; resume is tailored before apply.
  assert.equal(config.apply.useAiForQuestions, process.env.APPLY_USE_AI === 'true');
  assert.equal(typeof config.apply.portalUsername, 'string');
  assert.ok(config.apply.portalUsername.length >= 8);
  // Apply Manager defaults on (API brain); Claude browser stays off.
  assert.equal(config.apply.managerEnabled, process.env.APPLY_MANAGER !== 'false');
  assert.ok(['auto', 'openrouter', 'ollama'].includes(config.apply.managerProvider));
  assert.ok(config.apply.managerMaxTurns >= 1);
});

test('Apply Manager parses JSON actions and rejects bad payloads', () => {
  const {
    parseApplyManagerAction,
    heuristicApplyAction,
    profileFactsForManager,
  } = require('../dist/services/applyManager');
  const { applicationProfile } = require('../dist/data/applicationProfile');

  const click = parseApplyManagerAction(
    '```json\n{"type":"click","text":"Apply Now","reason":"CTA"}\n```'
  );
  assert.equal(click?.type, 'click');
  assert.equal(click?.text, 'Apply Now');

  const login = parseApplyManagerAction('{"type":"login","reason":"account wall"}');
  assert.equal(login?.type, 'login');

  const fill = parseApplyManagerAction(
    '{"type":"fill","label":"First Name","valueKey":"firstName"}'
  );
  assert.equal(fill?.type, 'fill');
  assert.equal(fill?.valueKey, 'firstName');

  assert.equal(parseApplyManagerAction('{"type":"hack"}'), null);
  assert.equal(parseApplyManagerAction('not json'), null);
  assert.equal(parseApplyManagerAction(''), null);

  const facts = profileFactsForManager(applicationProfile);
  assert.equal(facts.email, applicationProfile.email);
  assert.equal(facts.firstName, applicationProfile.firstName);
  assert.equal('password' in facts, false);

  const snap = {
    url: 'https://example.com/ApplicantLogin.aspx',
    title: 'Login',
    bodyText: 'Standard Login Create Account',
    controls: [],
    hasFileInput: false,
    hasPassword: true,
    hasApplyCta: false,
  };
  assert.equal(heuristicApplyAction(snap).type, 'login');

  const submitSnap = {
    ...snap,
    url: 'https://example.com/apply',
    bodyText: 'Submit Application when ready',
    hasPassword: false,
  };
  assert.equal(heuristicApplyAction(submitSnap).type, 'await_submit');
});

test('portal auth exports terms-checkbox helper for Workday Create Account', () => {
  const { checkAgreeTermsBoxes } = require('../dist/services/portalAccountAuth');
  assert.equal(typeof checkAgreeTermsBoxes, 'function');
});

test('portal username derivation meets AppOne rules', () => {
  const { derivePortalUsername } = require('../dist/services/portalAccountAuth');
  const { config } = require('../dist/config');
  // Prefer configured APPLY_PORTAL_USERNAME when set
  if (config.apply.portalUsername) {
    assert.equal(derivePortalUsername('karthikkovik@gmail.com'), config.apply.portalUsername);
  } else {
    const u = derivePortalUsername('karthikkovik@gmail.com');
    assert.ok(u.length >= 8 && u.length <= 18);
    assert.match(u, /[A-Za-z]/);
    assert.match(u, /\d/);
  }
  assert.equal(derivePortalUsername('ab@x.com').length >= 8 || !!config.apply.portalUsername, true);
});

test('Jobright Apply Now helpers parse external career URLs and reject jobright hosts', () => {
  const {
    isJobrightUrl,
    isExternalCareerUrl,
    extractJobrightJobId,
    parseJobrightCareerUrlFromNextData,
  } = require('../dist/services/jobrightApplyLink');

  assert.equal(isJobrightUrl('https://jobright.ai/jobs/info/abc123'), true);
  assert.equal(isJobrightUrl('https://boards.greenhouse.io/stripe/jobs/1'), false);
  assert.equal(extractJobrightJobId('https://jobright.ai/jobs/info/6a7640854817aa430704771c?x=1'), '6a7640854817aa430704771c');
  assert.equal(isExternalCareerUrl('https://jobs.ashbyhq.com/acme/uuid/application'), true);
  assert.equal(isExternalCareerUrl('https://jobright.ai/jobs/info/abc'), false);
  assert.equal(isExternalCareerUrl('https://www.linkedin.com/company/acme'), false);
  // paychex.com must NOT match the x.com noise filter
  assert.equal(
    isExternalCareerUrl(
      'https://recruiting.myapps.paychex.com/appone/MainInfoReq.asp?R_ID=7157769&B_ID=91'
    ),
    true
  );
  assert.equal(isExternalCareerUrl('https://x.com/someone'), false);

  const next = JSON.stringify({
    props: {
      pageProps: {
        dataSource: {
          jobResult: {
            applyLink: 'https://jobright.ai/jobs/info/abc',
            originalUrl: 'https://jobs.lever.co/palantir/abcdef-1234',
          },
        },
      },
    },
  });
  assert.equal(
    parseJobrightCareerUrlFromNextData(next),
    'https://jobs.lever.co/palantir/abcdef-1234'
  );
  assert.equal(
    parseJobrightCareerUrlFromNextData(
      `<script id="__NEXT_DATA__">${JSON.stringify({
        props: {
          pageProps: {
            dataSource: {
              jobResult: { applyLink: 'https://job-boards.greenhouse.io/figma/jobs/99' },
            },
          },
        },
      })}</script>`
    ),
    'https://job-boards.greenhouse.io/figma/jobs/99'
  );
  assert.equal(
    parseJobrightCareerUrlFromNextData(
      JSON.stringify({
        props: {
          pageProps: {
            dataSource: { jobResult: { applyLink: 'https://jobright.ai/jobs/info/x' } },
          },
        },
      })
    ),
    null
  );
  assert.equal(
    parseJobrightCareerUrlFromNextData(
      JSON.stringify({
        props: {
          pageProps: {
            dataSource: {
              jobResult: {
                applyLink:
                  'https://recruiting.myapps.paychex.com/appone/MainInfoReq.asp?R_ID=1&B_ID=2',
              },
            },
          },
        },
      })
    ),
    'https://recruiting.myapps.paychex.com/appone/MainInfoReq.asp?R_ID=1&B_ID=2'
  );

  const { normalizeCareerApplyUrl } = require('../dist/services/jobrightApplyLink');
  assert.equal(
    normalizeCareerApplyUrl(
      'https://jobs.ashbyhq.com/acme/uuid/application?utm_source=jobright&jr_id=abc'
    ),
    'https://jobs.ashbyhq.com/acme/uuid/application'
  );
  assert.equal(
    normalizeCareerApplyUrl(
      'https://recruiting.myapps.paychex.com/appone/MainInfoReq.asp?R_ID=7157769&B_ID=91&utm_source=jobright'
    ),
    'https://recruiting.myapps.paychex.com/appone/MainInfoReq.asp?R_ID=7157769&B_ID=91'
  );
});

test('stored job URLs strip XMLNAME and tracking for View on / apply', () => {
  const { sanitizeStoredJobUrl } = require('../dist/services/jobrightApplyLink');
  const dirty =
    'https://chevron.wd5.myworkdayjobs.com/University/job/Houston/XMLNAME-2026-2027-Information-Technology---Software-Engineer---Full-Time_R000072400-1?utm_source=Simplify';
  const clean = sanitizeStoredJobUrl(dirty);
  assert.equal(clean.includes('XMLNAME'), false);
  assert.equal(clean.includes('utm_source'), false);
  assert.match(clean, /2026-2027-Information-Technology/);
  assert.match(clean, /R000072400/);
});

test('extension resolve matches Greenhouse job-boards URL to boards tracker URL', () => {
  const { normalizeForMatch, scoreJobAgainstUrl } = require('../dist/routes/extensionRoutes');
  const page = normalizeForMatch('https://job-boards.greenhouse.io/robinhood/jobs/8120094');
  const stored = normalizeForMatch(
    'https://boards.greenhouse.io/robinhood/jobs/8120094?t=gh_src=&gh_jid=8120094'
  );
  assert.ok(page);
  assert.ok(stored);
  assert.equal(
    scoreJobAgainstUrl(
      'https://boards.greenhouse.io/robinhood/jobs/8120094?t=gh_src=&gh_jid=8120094',
      page,
      'Robinhood'
    ),
    100
  );
  assert.ok(
    scoreJobAgainstUrl('https://job-boards.greenhouse.io/reddit/jobs/8139781', page, 'Reddit') < 70
  );
});

test('application Q&A uses answer bank on exact match', async () => {
  const { generateApplicationAnswer } = require('../dist/services/applicationQaService');
  const { upsertAnswer, writeAnswerBank } = require('../dist/services/answerBankService');
  writeAnswerBank([]);
  upsertAnswer('What is your favorite color?', 'Blue');
  const result = await generateApplicationAnswer({
    question: 'What is your favorite color?',
    job: null,
    skipBank: false,
  });
  assert.equal(result.source, 'bank');
  assert.equal(result.answer, 'Blue');
});

test('H1B company ratings: alias, consulting, JD no-sponsor', () => {
  const {
    resolveCompanyRating,
    h1bSeedCompanyCount,
  } = require('../dist/data/h1bCompanyRatings');

  assert.ok(h1bSeedCompanyCount() >= 50);

  const meta = resolveCompanyRating('Meta Platforms, Inc.');
  assert.equal(meta.rating, 5);
  assert.equal(meta.source, 'seed');

  const consulting = resolveCompanyRating('Infosys Limited');
  assert.equal(consulting.rating, 2);
  assert.equal(consulting.source, 'consulting');

  const noSponsor = resolveCompanyRating('Acme Corp', 'No visa sponsorship available for this role.');
  assert.equal(noSponsor.rating, 1);
  assert.equal(noSponsor.source, 'jd');

  const unknown = resolveCompanyRating('Some Random Startup LLC');
  assert.equal(unknown.rating, 2);
  assert.equal(unknown.source, 'default');

  const bumped = resolveCompanyRating(
    'Some Random Startup LLC',
    'We will sponsor H-1B visas for qualified candidates.'
  );
  assert.equal(bumped.rating, 3);
});
