const assert = require('node:assert/strict');
const test = require('node:test');

const { detectCompanyRedFlags } = require('../dist/services/companyVerifyService');

test('detects known staffing firms by name', () => {
  const r = detectCompanyRedFlags('Apex Systems');
  assert.ok(r.staffing);
  assert.match(r.staffing, /staffing|body-shop/i);
});

test('detects profile-marketing JD language', () => {
  const r = detectCompanyRedFlags(
    'Random Tech LLC',
    'We are a staffing firm. We will market your profile to our clients and keep you on the bench.'
  );
  assert.ok(r.marketing);
});

test('does not flag Google as staffing', () => {
  const r = detectCompanyRedFlags(
    'Google',
    'Software Engineer New Grad. Build APIs in Java and Python. Full-time role.'
  );
  assert.equal(r.staffing, undefined);
  assert.equal(r.marketing, undefined);
});

test('gateCompanyForScrape skips known staffing before scrape work', async () => {
  const { gateCompanyForScrape, clearCompanyVerifyCache } = require('../dist/services/companyVerifyService');
  clearCompanyVerifyCache();
  const skipped = await gateCompanyForScrape('TEKsystems');
  assert.equal(skipped, null);
});

test('gateCompanyForScrape allows trusted product companies', async () => {
  const { gateCompanyForScrape, clearCompanyVerifyCache } = require('../dist/services/companyVerifyService');
  clearCompanyVerifyCache();
  const ok = await gateCompanyForScrape('Google');
  assert.ok(ok);
  assert.equal(ok.skip, false);
});
