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
  assert.deepEqual(filter.$or[1], { status: 'failed', resumePhase: 'failed' });
  assert.deepEqual(filter.$or[2], { status: 'resume_generating' });
});

test('masters F-1 eligibility skips citizenship-only but keeps no-sponsorship jobs', () => {
  const {
    isIneligibleForMastersF1,
    shouldSkipJobDescription,
    isUndergraduateOnlyJob,
  } = require('../dist/services/jobSkipRules');

  assert.equal(
    isIneligibleForMastersF1('SWE Intern', 'Must be a U.S. citizen. Summer 2027.'),
    true
  );
  // Keep jobs that don't offer sponsorship (CPT/OPT can still apply)
  assert.equal(
    isIneligibleForMastersF1('SWE Intern', 'No visa sponsorship available for this role.'),
    false
  );
  assert.equal(isIneligibleForMastersF1('SWE Intern', 'No sponsorship available.'), false);
  assert.equal(isIneligibleForMastersF1('SWE Intern', 'no sponsorship available'), false);
  assert.equal(
    isIneligibleForMastersF1(
      'SWE Intern',
      'Must already be authorized to work in the U.S. without sponsorship.'
    ),
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

  const keep = shouldSkipJobDescription(
    'Software Engineering Intern',
    'Acme',
    'This role does not offer visa sponsorship. Summer 2027 internship.'
  );
  assert.equal(keep.skip, false);

  const skipCitizen = shouldSkipJobDescription(
    'Software Engineering Intern',
    'Acme',
    'Must be a U.S. citizen. Summer 2027 software internship.'
  );
  assert.equal(skipCitizen.skip, true);
  assert.match(skipCitizen.reason || '', /citizenship|F-1/i);
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
  assert.match(out, /\\uline\{\\textbf\{Amazon\}/);
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
