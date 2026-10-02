import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BUDGETS, TEAM_SIZES } from '../lib/contact.ts';
import { researchResultSchema, scoreLead } from '../lib/lead-research.ts';

const research = {
  companyDescription: 'A design firm with a high-end Manhattan office.',
  match: 'matched', nycOffice: 'confirmed', premiumOffice: 'strong',
  purchaseIntent: 'explicit', confidence: 'high',
  rationale: 'An NYC office and a concrete office-furniture request.',
  sources: [{ title: 'Company office', url: 'https://example.com/offices/nyc' }],
};
const parsed = (overrides = {}) => researchResultSchema.parse({ ...research, ...overrides });

const targetBudget = '$30,000–$50,000';

test('scores a strong NYC lead using the fixed rubric, up to 100', () => {
  assert.deepEqual(scoreLead(parsed(), '201–1,000', targetBudget), {
    score: 100, label: 'Strong fit',
    breakdown: { nycOffice: 30, premiumOffice: 15, teamSize: 5, purchaseIntent: 10, budget: 40 },
  });
  assert.deepEqual(TEAM_SIZES.map((size) => scoreLead(parsed(), size, targetBudget).breakdown.teamSize), [1, 2, 3, 5, 5]);
  for (const [key, values, points] of [
    ['nycOffice', ['confirmed', 'outside_nyc', 'unknown'], [30, 0, 0]],
    ['premiumOffice', ['strong', 'some', 'unknown'], [15, 8, 0]],
    ['purchaseIntent', ['explicit', 'exploratory', 'none'], [10, 5, 0]],
  ]) {
    assert.deepEqual(values.map((value) => scoreLead(parsed({ [key]: value }), '1,000+', targetBudget).breakdown[key]), points);
  }
});

test('target budget ranks highest; below $30k cannot be Strong fit even with other signals maxed', () => {
  const expected = [
    ['Under $10,000', 0, 60, 'Possible fit'],
    ['$10,000–$29,999', 10, 70, 'Possible fit'],
    ['$30,000–$50,000', 40, 100, 'Strong fit'],
    ['Over $50,000', 35, 95, 'Strong fit'],
    ['Not sure yet', 0, 60, 'Possible fit'],
  ];
  assert.deepEqual(BUDGETS, expected.map(([budget]) => budget));
  for (const [budget, points, score, label] of expected) {
    const result = scoreLead(parsed(), '1,000+', budget);
    assert.equal(result.breakdown.budget, points, budget);
    assert.equal(result.score, score, budget);
    assert.equal(result.label, label, budget);
    assert.ok(result.score >= 0 && result.score <= 100);
    if (budget !== targetBudget) assert.ok(result.score < 100, 'target budget ranks highest');
  }
});

test('distinguishes possible and low fits without NYC or premium signals', () => {
  assert.equal(scoreLead(parsed({ nycOffice: 'outside_nyc' }), '1,000+', targetBudget).label, 'Possible fit');
  assert.equal(scoreLead(parsed({ nycOffice: 'outside_nyc', premiumOffice: 'unknown', purchaseIntent: 'none' }), '1–10', targetBudget).label, 'Low fit');
});

test('keeps label thresholds at 45 and 75', () => {
  for (const [nycOffice, teamSize, score, label] of [
    ['outside_nyc', '1–10', 44, 'Low fit'],
    ['outside_nyc', '11–50', 45, 'Possible fit'],
    ['confirmed', '1–10', 74, 'Possible fit'],
    ['confirmed', '11–50', 75, 'Strong fit'],
  ]) {
    const result = scoreLead(parsed({ nycOffice, premiumOffice: 'some', purchaseIntent: 'none' }), teamSize, 'Over $50,000');
    assert.equal(result.score, score);
    assert.equal(result.label, label);
  }
});

test('unknown office earns zero location points instead of blocking the score', () => {
  const result = scoreLead(parsed({ nycOffice: 'unknown', premiumOffice: 'unknown', purchaseIntent: 'none' }), '1–10', targetBudget);
  assert.equal(result.score, 41);
  assert.equal(result.label, 'Low fit');
  assert.equal(result.breakdown.nycOffice, 0);
});

test('always produces a number even with uncertain or unavailable research', () => {
  for (const overrides of [{ match: 'ambiguous' }, { match: 'unknown' }, { confidence: 'low' }, { sources: [] }]) {
    assert.equal(scoreLead(parsed(overrides), '1,000+', targetBudget).score, 100);
  }
  assert.deepEqual(scoreLead(undefined, '11–50', targetBudget), {
    score: 42, label: 'Low fit',
    breakdown: { nycOffice: 0, premiumOffice: 0, teamSize: 2, purchaseIntent: 0, budget: 40 },
  });
});

test('legacy callers may omit budget without guessed points or losing known signals', () => {
  assert.deepEqual(scoreLead(parsed(), '1,000+'), {
    score: 60, label: 'Possible fit',
    breakdown: { nycOffice: 30, premiumOffice: 15, teamSize: 5, purchaseIntent: 10, budget: 0 },
  });
  assert.deepEqual(scoreLead(undefined, '11–50'), {
    score: 2, label: 'Low fit',
    breakdown: { nycOffice: 0, premiumOffice: 0, teamSize: 2, purchaseIntent: 0, budget: 0 },
  });
});

test('validates the structured result and keeps it short', () => {
  assert.equal(researchResultSchema.safeParse({}).success, false);
  assert.equal(researchResultSchema.safeParse({ ...research, confidence: 'made up' }).success, false);
  assert.equal(researchResultSchema.safeParse({ ...research, companyDescription: 'x'.repeat(361) }).success, false);
  assert.equal(researchResultSchema.safeParse({ ...research, sources: Array(4).fill(research.sources[0]) }).success, false);
  assert.equal(parsed({ companyDescription: '  A design firm.  ' }).companyDescription, 'A design firm.');
});

test('source links must be valid HTTPS URLs without credentials', () => {
  assert.equal(parsed().sources[0].url, research.sources[0].url);
  for (const url of ['not a URL', 'http://example.com', 'https://user:password@example.com']) {
    assert.equal(researchResultSchema.safeParse({ ...research, sources: [{ title: 'Source', url }] }).success, false);
  }
});

test('full-project qualification prevents frame-shop and unrelated requests becoming Strong fit', () => {
  for (const projectScope of ['single_item', 'unrelated', 'unknown', 'full_project']) {
    const qualified = parsed({ qualification: { projectScope, timing: null } });
    assert.equal(scoreLead(qualified, '1,000+', targetBudget).label,
      projectScope === 'full_project' ? 'Strong fit' : projectScope === 'unknown' ? 'Possible fit' : 'Low fit');
  }
});

test('follow-up asks for missing details and offers consultation only for promising projects', async () => {
  const { leadFollowUp } = await import('../lib/lead-research.ts');
  const qualified = parsed({ qualification: { projectScope: 'full_project', timing: null } });
  const result = leadFollowUp(qualified, 'Not sure yet');
  assert.match(result.draft, /end-to-end/);
  assert.match(result.draft, /design consultation/);
  assert.match(result.draft, /budget range/);
  assert.match(result.draft, /timeline/);
  assert.ok(!result.draft.includes('$30'));
  assert.deepEqual(leadFollowUp(parsed({ qualification: { projectScope: 'full_project', timing: 'next spring' } }), targetBudget).questions, []);
  for (const projectScope of ['single_item', 'unrelated', 'unknown']) {
    assert.equal(leadFollowUp(parsed({ qualification: { projectScope, timing: null } }), targetBudget).draft, null);
  }
  assert.equal(leadFollowUp(parsed(), targetBudget), undefined);
});
