import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
import { researchResultSchema } from '../lib/lead-research.ts';

const records = new Map();
const get = mock.fn(async (key) => structuredClone(records.get(key) ?? null));
const write = async (key, value) => { records.set(key, structuredClone(value)); return 'OK'; };
const set = mock.fn(write);
const fromEnv = mock.fn(() => ({ get, set }));
mock.module('@upstash/redis', { namedExports: { Redis: { fromEnv } } });
const { createLead, saveLead, getLead } = await import('../lib/lead-store.ts');

const submission = {
  name: 'Jordan Lee', email: 'jordan@OriginalStudio.com', company: 'Original Studio',
  teamSize: '51–200', budget: '$30,000–$50,000', message: 'We need furniture for our new NYC office.\nPlease send options. 𐐀',
};
const enrichment = {
  status: 'complete', sessionId: 'research_123', createdAt: 1789000100,
  research: researchResultSchema.parse({
    companyDescription: 'A design studio with a Manhattan headquarters.',
    match: 'matched', nycOffice: 'confirmed', premiumOffice: 'strong',
    purchaseIntent: 'explicit', confidence: 'high', rationale: 'The office page supports the fit.',
    sources: [{ title: 'Office', url: 'https://example.com/office' }],
  }),
};

beforeEach((t) => {
  records.clear();
  get.mock.resetCalls();
  set.mock.resetCalls();
  set.mock.mockImplementation(write);
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected network request'); });
});

test('round trips all submitted data, including budget, email, paragraphs and Unicode', async (t) => {
  t.mock.method(Date, 'now', () => 1789000000123);
  const lead = await createLead(submission);
  assert.match(lead.id, /^lead-[0-9a-f-]{36}$/);
  assert.deepEqual(lead, { id: lead.id, createdAt: 1789000000, updatedAt: 1789000000, submission });
  assert.equal(fromEnv.mock.callCount(), 1);
  assert.deepEqual(set.mock.calls[0].arguments, [`dreamforce:lead:${lead.id}`, lead]);
  assert.deepEqual(await getLead(lead.id), lead);
  assert.deepEqual(get.mock.calls[0].arguments, [`dreamforce:lead:${lead.id}`]);
  assert.notEqual((await createLead(submission)).id, lead.id);
});

test('enrichment and Slack coordinates update the same record without losing original submission or identity', async () => {
  const lead = await createLead(submission);
  const updated = { ...lead, updatedAt: lead.updatedAt + 1, enrichment };
  await saveLead(updated);
  assert.deepEqual(await getLead(lead.id), updated);
  assert.equal(records.size, 1);
  const delivered = { ...updated, slack: { channel: 'C123', ts: '1789000200.123456' } };
  await saveLead(delivered);
  assert.deepEqual(await getLead(lead.id), delivered);
  assert.equal(records.size, 1);
  assert.deepEqual(lead.submission, submission);
});

test('legacy records load and save without inventing a budget', async () => {
  const { budget: _budget, ...legacySubmission } = submission;
  const legacy = {
    id: 'lead-12345678-1234-4234-8234-123456789abc',
    createdAt: 1789000000, updatedAt: 1789000200, submission: legacySubmission, enrichment,
  };
  records.set(`dreamforce:lead:${legacy.id}`, structuredClone(legacy));
  const loaded = await getLead(legacy.id);
  assert.deepEqual(loaded, legacy);
  assert.equal(Object.hasOwn(loaded.submission, 'budget'), false);
  assert.equal(set.mock.callCount(), 0, 'loading an old record must not migrate it');
  await saveLead({ ...loaded, slack: { channel: 'C123', ts: '1789000200.123456' } });
  const updated = await getLead(legacy.id);
  assert.deepEqual(updated.submission, legacySubmission);
  assert.equal(Object.hasOwn(updated.submission, 'budget'), false);
  assert.deepEqual(updated.enrichment, enrichment);
  assert.equal(records.size, 1);
});

test('missing records return null', async () => {
  const id = 'lead-12345678-1234-4234-8234-123456789abc';
  assert.equal(await getLead(id), null);
  assert.deepEqual(get.mock.calls[0].arguments, [`dreamforce:lead:${id}`]);
});

test('old and invalid IDs return null without reading Redis', async () => {
  for (const id of ['eve-research_123', 'demo-12345678', '', '../lead', 'lead-invalid']) {
    assert.equal(await getLead(id), null);
  }
  assert.equal(get.mock.callCount(), 0);
});

test('failed initial write rejects rather than returning an unsaved lead', async () => {
  const error = new Error('KV unavailable');
  set.mock.mockImplementation(async () => { throw error; });
  await assert.rejects(createLead(submission), (caught) => caught === error);
  assert.equal(set.mock.callCount(), 1);
  assert.equal(records.size, 0);
});
