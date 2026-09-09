const assert = require('node:assert/strict');
const test = require('node:test');

const {
  scoreJdQuality,
  isJdRichEnoughForResume,
  preferBetterJd,
  isLikelyEmployerApplyUrl,
} = require('../dist/services/jdQuality');

const RICH_JD = `
Job Description
About the role
We are looking for a Software Engineer to build backend APIs.

Responsibilities
- Design REST APIs in Java and Spring Boot
- Ship AWS Lambda services with DynamoDB and SQS
- Collaborate with frontend engineers on React TypeScript clients

Minimum Qualifications
- Bachelor's or Master's in Computer Science
- Experience with Python, SQL, CI/CD, PostgreSQL
- Strong software engineering fundamentals

Preferred Qualifications
- AWS, Docker, Redis, Node.js
`.repeat(2);

const THIN_JD =
  'Software Engineer at Acme. Build things with Java and React. Apply now.';

test('scoreJdQuality prefers structured employer text over chrome-heavy previews', () => {
  const rich = scoreJdQuality(RICH_JD);
  const thin = scoreJdQuality(THIN_JD);
  const chrome = scoreJdQuality(
    `${THIN_JD}\nApply with Autofill\nJob Recommendations\nCustomize Your Resume\nCookie Privacy Policy`
  );
  assert.ok(rich > thin);
  assert.ok(thin >= chrome);
});

test('isJdRichEnoughForResume requires real posting depth', () => {
  assert.equal(isJdRichEnoughForResume(RICH_JD), true);
  assert.equal(isJdRichEnoughForResume(THIN_JD), false);
  assert.equal(isJdRichEnoughForResume(''), false);
});

test('preferBetterJd keeps the higher-quality description', () => {
  assert.equal(preferBetterJd(THIN_JD, RICH_JD, 'b'), preferBetterJd(RICH_JD, RICH_JD, 'a'));
  assert.ok(preferBetterJd(THIN_JD, RICH_JD).includes('Responsibilities'));
});

test('isLikelyEmployerApplyUrl rejects aggregators', () => {
  assert.equal(isLikelyEmployerApplyUrl('https://boards.greenhouse.io/acme/jobs/123'), true);
  assert.equal(isLikelyEmployerApplyUrl('https://jobs.lever.co/acme/abcd'), true);
  assert.equal(isLikelyEmployerApplyUrl('https://jobright.ai/jobs/info/xyz'), false);
  assert.equal(isLikelyEmployerApplyUrl('https://www.linkedin.com/jobs/view/123'), false);
});

test('cleanJobDescription keeps Equal Opportunity / full employer posting', () => {
  const { cleanJobDescriptionForResume, looksTruncatedJd } = require('../dist/services/cleanJobDescription');
  const amazon = `${RICH_JD}

Amazon is an equal opportunity employer and Minority/Female/Disability/Veteran/Gender Identity/Sexual Orientation/Age.
We celebrate diversity and are committed to creating an inclusive environment.`;
  const cleaned = cleanJobDescriptionForResume(amazon);
  assert.match(cleaned, /equal opportunity employer/i);
  assert.match(cleaned, /inclusive environment/i);
  assert.equal(looksTruncatedJd('...operations Amazon is an'), true);
  assert.equal(looksTruncatedJd('...including with regard to use of'), true);
  assert.equal(looksTruncatedJd(cleaned), false);
});

test('htmlToPreformattedJd keeps headings and bullets for <pre> display', () => {
  const { htmlToPreformattedJd, cleanJobDescriptionForResume, normalizePreformattedJd } = require('../dist/services/cleanJobDescription');
  const html = `
    <h2>About the Role</h2>
    <p>Build APIs in <strong>Java</strong> and Python.</p>
    <h3>Requirements</h3>
    <ul>
      <li>Bachelor's in Computer Science</li>
      <li>Experience with AWS and Docker</li>
    </ul>
    <p>Amazon is an equal opportunity employer.</p>
  `;
  const pre = htmlToPreformattedJd(html);
  assert.match(pre, /About the Role/);
  assert.match(pre, /• Bachelor/);
  assert.match(pre, /• Experience with AWS/);
  assert.match(pre, /equal opportunity employer/i);
  // Bullets should be consecutive — no blank line between them
  assert.match(pre, /• Bachelor[^\n]*\n• Experience/);
  assert.equal(/\n{3,}/.test(pre), false);
  const cleaned = cleanJobDescriptionForResume(html);
  assert.match(cleaned, /• Bachelor/);

  const airy = `What You'll Help Build

As a Cloud Engineer you will:

• First item

• Second item

• Third item

Done.`;
  const tight = normalizePreformattedJd(airy);
  assert.match(tight, /• First item\n• Second item\n• Third item/);
  assert.equal(/\n{3,}/.test(tight), false);
});
