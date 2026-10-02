import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildContactSlackMessage } from '../app/api/contact/slack-message.ts';
import { BUDGETS, CONTACT_LIMITS, TEAM_SIZES, contactSubmissionSchema } from '../lib/contact.ts';
import { researchResultSchema } from '../lib/lead-research.ts';

const submission = {
  name: 'Jane Doe', email: 'jane@example.com', company: 'Acme',
  teamSize: '11–50', budget: '$30,000–$50,000', message: 'Help with our launch.\nWe have two teams.',
};
const identity = { id: 'lead-12345678-1234-4234-8234-123456789abc', createdAt: 1789000000 };
const updatedIdentity = { ...identity, updatedAt: 1789000200 };
const complete = {
  status: 'complete', sessionId: 'session_builder-123', createdAt: 1789000100,
  research: researchResultSchema.parse({
    companyDescription: 'Acme designs software in a premium Manhattan office.',
    match: 'matched', nycOffice: 'confirmed', premiumOffice: 'strong',
    purchaseIntent: 'exploratory', confidence: 'high',
    rationale: 'Its NYC office and premium workspace are a strong furniture fit.',
    sources: [
      { title: 'Acme offices', url: 'https://example.com/acme/offices' },
      { title: 'Workspace design', url: 'https://example.com/acme/design' },
    ],
  }),
};
function payload(input = submission) {
  return buildContactSlackMessage(contactSubmissionSchema.parse(input), identity);
}
function entity(result) { return result.metadata.entities[0]; }
function fields(result) { return entity(result).entity_payload.custom_fields; }
function field(result, key) { return fields(result).find((field) => field.key === key); }

test('posts a real Item Work Object rather than Block Kit imitation', () => {
  const result = payload();
  assert.equal(result.blocks, undefined);
  assert.equal(result.attachments, undefined);
  assert.equal(result.metadata.entities.length, 1);
  const item = entity(result);
  assert.equal(item.entity_type, 'slack#/entities/item');
  assert.equal(item.app_unfurl_url, undefined);
  assert.deepEqual(item.external_ref, { id: identity.id, type: 'lead' });
  assert.equal(item.url, `https://example.com/demo/leads/${identity.id}`);
  assert.deepEqual(item.entity_payload.attributes, {
    title: { text: 'Inbound Lead' }, display_type: 'Lead', display_id: 'LEAD-12345678',
    product_name: 'nyc-framing', metadata_last_modified: identity.createdAt,
  });
  assert.equal(item.entity_payload.fields, undefined, 'generic Item uses custom_fields only');
  assert.deepEqual(item.entity_payload.display_order, ['full_name', 'company', 'budget', 'icp_fit', 'confidence', 'team_size', 'status', 'description', 'source']);
  assert.deepEqual(fields(result).map(({ key, value }) => [key, value]), [
    ['full_name', 'Jane Doe'], ['company', 'Acme'], ['team_size', '11–50'], ['budget', submission.budget],
    ['status', 'New'], ['description', submission.message], ['source', 'Contact Us Form'],
    ['icp_fit', '42/100 · Low fit'], ['confidence', 'Pending'],
  ]);
  assert.deepEqual(field(result, 'budget'), { key: 'budget', label: 'Budget (USD)', type: 'string', value: submission.budget });
  assert.equal(field(result, 'description').long, true);
  assert.equal(field(result, 'status').tag_color, 'blue');
});

test('complete enrichment preserves the stored identity and uses updatedAt with deterministic research fields', () => {
  const result = buildContactSlackMessage(submission, updatedIdentity, complete);
  assert.deepEqual(buildContactSlackMessage(submission, updatedIdentity, complete), result);
  const item = entity(result);
  assert.deepEqual(item.external_ref, entity(payload()).external_ref);
  assert.equal(item.url, entity(payload()).url);
  assert.deepEqual(item.entity_payload.attributes, {
    title: { text: 'Inbound Lead' }, display_type: 'Lead', display_id: 'LEAD-12345678',
    product_name: 'nyc-framing', metadata_last_modified: updatedIdentity.updatedAt,
  });
  assert.equal(field(result, 'icp_fit').value, '92/100 · Strong fit');
  assert.equal(field(result, 'company_overview').value, complete.research.companyDescription);
  assert.equal(field(result, 'company_overview').long, true);
  assert.equal(field(result, 'fit_reason').value, complete.research.rationale);
  assert.equal(field(result, 'fit_reason').long, true);
  assert.equal(field(result, 'confidence').value, 'high');
  assert.deepEqual(fields(result).slice(0, 7), fields(payload()).slice(0, 7));
  assert.deepEqual(fields(result).filter(({ key }) => key.startsWith('research_source_')),
    complete.research.sources.map(({ title, url }, index) => ({
      key: `research_source_${index}`, label: title, type: 'slack#/types/link', value: url,
    })));
  assert.deepEqual(item.entity_payload.display_order, [
    'full_name', 'company', 'budget', 'icp_fit', 'company_overview', 'fit_reason', 'confidence',
    'team_size', 'status', 'description', 'source', 'research_source_0', 'research_source_1',
  ]);
  assert.equal(JSON.stringify(result).includes(submission.email), false);
  // Expected totals are independent of scoreLead, including the submitted team size.
  for (const [teamSize, score] of [['1–10', 91], ['11–50', 92], ['51–200', 93], ['201–1,000', 95], ['1,000+', 95]]) {
    assert.equal(field(buildContactSlackMessage({ ...submission, teamSize }, identity, complete), 'icp_fit').value, `${score}/100 · Strong fit`);
  }
});

test('unknown research scores only the available signals', () => {
  const research = researchResultSchema.parse({
    companyDescription: 'The submitted company could not be identified.',
    match: 'unknown', nycOffice: 'unknown', premiumOffice: 'unknown',
    purchaseIntent: 'none', confidence: 'low', rationale: 'No reliable public evidence was found.',
    sources: [],
  });
  const result = buildContactSlackMessage(submission, identity, { ...complete, research });
  assert.equal(field(result, 'icp_fit').value, '42/100 · Low fit');
  assert.equal(entity(result).external_ref.id, identity.id);
  assert.equal(field(result, 'company_overview').value, research.companyDescription);
  assert.equal(field(result, 'fit_reason').value, research.rationale);
  assert.equal(field(result, 'confidence').value, 'low');
  assert.equal(fields(result).some(({ key }) => key.startsWith('research_source_')), false);
});

test('unavailable enrichment retains stored identity and submitted fields without fake research', () => {
  const result = buildContactSlackMessage(submission, updatedIdentity, { status: 'unavailable', createdAt: 1789000100 });
  const original = payload();
  assert.deepEqual(entity(result).external_ref, entity(original).external_ref);
  assert.equal(entity(result).url, entity(original).url);
  assert.deepEqual(entity(result).entity_payload.attributes, {
    ...entity(original).entity_payload.attributes, metadata_last_modified: updatedIdentity.updatedAt,
  });
  assert.deepEqual(fields(result).slice(0, 7), fields(original).slice(0, 7));
  assert.equal(field(result, 'icp_fit').value, '42/100 · Low fit');
  assert.equal(field(result, 'confidence').value, 'Unavailable');
});

test('uses only the explicit stored identity with no PII in placeholder URLs', () => {
  const first = entity(buildContactSlackMessage(submission, identity));
  const second = entity(buildContactSlackMessage(submission, identity));
  assert.equal(first.external_ref.id, identity.id);
  assert.deepEqual(first, second);
  assert.equal(new URL(first.url).hostname, 'example.com');
  assert.equal(new URL(first.url).search, '');
  assert.ok(!first.url.includes(submission.email));
  assert.ok(!first.url.includes(submission.name));
  assert.equal(first.entity_payload.actions, undefined);
});

test('keeps submitted values plain rather than enabling markdown or mentions', () => {
  const result = payload({ ...submission, name: '<@U123>', company: 'A & B <!channel>', message: '*Hello*\n<@U456>' });
  assert.equal(field(result, 'full_name').value, '<@U123>');
  assert.equal(field(result, 'company').value, 'A & B <!channel>');
  assert.equal(field(result, 'description').value, '*Hello*\n<@U456>');
  assert.ok(fields(result).every((field) => field.type === 'string' && field.format === undefined && field.link === undefined));
  assert.equal(result.text, 'New inbound lead from the Contact Us Form.');
  assert.equal(result.mrkdwn, false);
  assert.equal(result.parse, 'none');
  assert.equal(result.unfurl_links, false);
  assert.equal(result.unfurl_media, false);
});

test('preserves maximum-length submissions and all accepted team sizes', () => {
  for (const teamSize of TEAM_SIZES) {
    const input = { ...submission, name: 'n'.repeat(CONTACT_LIMITS.name), company: '&'.repeat(CONTACT_LIMITS.company), teamSize, message: 'm'.repeat(CONTACT_LIMITS.message) };
    const result = payload(input);
    assert.equal(field(result, 'full_name').value, input.name);
    assert.equal(field(result, 'company').value, input.company);
    assert.equal(field(result, 'team_size').value, teamSize);
    assert.equal(field(result, 'description').value, input.message);
  }
});

test('renders every accepted budget unchanged and scores it in the Work Object', () => {
  for (const [budget, score, label] of [
    ['Under $10,000', 52, 'Possible fit'], ['$10,000–$29,999', 62, 'Possible fit'],
    ['$30,000–$50,000', 92, 'Strong fit'], ['Over $50,000', 87, 'Strong fit'],
    ['Not sure yet', 52, 'Possible fit'],
  ]) {
    assert.ok(BUDGETS.includes(budget));
    const input = contactSubmissionSchema.parse({ ...submission, budget });
    const result = buildContactSlackMessage(input, identity, complete);
    assert.equal(field(result, 'budget').value, budget);
    assert.ok(entity(result).entity_payload.display_order.includes('budget'));
    assert.equal(field(result, 'icp_fit').value, `${score}/100 · ${label}`);
  }
});

test('legacy builder input shows Not provided and scores only known signals', () => {
  const { budget: _budget, ...legacy } = submission;
  for (const [enrichment, score, label] of [
    [undefined, 2, 'Low fit'], [{ status: 'unavailable', createdAt: identity.createdAt }, 2, 'Low fit'],
    [complete, 52, 'Possible fit'],
  ]) {
    const result = buildContactSlackMessage(legacy, identity, enrichment);
    assert.equal(field(result, 'budget').value, 'Not provided');
    assert.ok(entity(result).entity_payload.display_order.includes('budget'));
    assert.equal(field(result, 'icp_fit').value, `${score}/100 · ${label}`);
    assert.equal(JSON.stringify(result).includes(submission.budget), false);
    assert.equal(JSON.stringify(result).includes('Not sure yet'), false);
  }
  assert.equal(Object.hasOwn(legacy, 'budget'), false);
});

test('requires every field and rejects invalid types, email, team size and budget', () => {
  for (const key of Object.keys(submission)) {
    for (const invalid of [undefined, null, '', '   ', 123, {}]) {
      assert.equal(contactSubmissionSchema.safeParse({ ...submission, [key]: invalid }).success, false, `${key}: ${JSON.stringify(invalid)}`);
    }
  }
  for (const input of [null, [], {}, { ...submission, email: 'not-an-email' }, { ...submission, teamSize: 'Select team size' }, { ...submission, name: 'Jane\nDoe' }]) {
    assert.equal(contactSubmissionSchema.safeParse(input).success, false);
  }
});

test('rejects over-limit fields instead of silently shortening them', () => {
  for (const key of ['name', 'company', 'message', 'email']) {
    assert.equal(contactSubmissionSchema.safeParse({ ...submission, [key]: 'a'.repeat(CONTACT_LIMITS[key] + 1) }).success, false, key);
  }
});

test('trims outer whitespace but preserves message paragraphs and Unicode', () => {
  const result = payload({ ...submission, name: ' Jane Doe ', company: ' Acme ', message: '  Hello 𐐀\n\nSecond paragraph.  ' });
  assert.equal(field(result, 'full_name').value, 'Jane Doe');
  assert.equal(field(result, 'description').value, 'Hello 𐐀\n\nSecond paragraph.');
});

test('qualified leads expose plain-text questions and review-only consultation drafts in Slack', () => {
  const research = researchResultSchema.parse({ ...complete.research,
    qualification: { projectScope: 'full_project', timing: null },
  });
  const result = buildContactSlackMessage({ ...submission, budget: 'Not sure yet' }, identity, { ...complete, research });
  assert.match(field(result, 'qualification_questions').value, /budget range/);
  assert.match(field(result, 'qualification_questions').value, /timeline/);
  assert.match(field(result, 'reply_draft').value, /design consultation/);
  assert.match(field(result, 'reply_draft').label, /review before sending/);
  assert.equal(field(result, 'reply_draft').type, 'string');
  assert.ok(entity(result).entity_payload.display_order.includes('reply_draft'));
});
