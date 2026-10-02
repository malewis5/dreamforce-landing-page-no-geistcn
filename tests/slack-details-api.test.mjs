import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { afterEach, beforeEach, mock, test } from 'node:test';
import { contactSubmissionSchema } from '../lib/contact.ts';
import { researchResultSchema } from '../lib/lead-research.ts';
import { matchDemoTrigger } from '../lib/demo-trigger.ts';
import demoConfig from '../demo.config.json' with { type: 'json' };
import { scenes } from '../scripts/demo-scenes.mjs';

const routeUrl = new URL('../app/triggers/slack/route.ts', import.meta.url).href;
const storeUrl = new URL('../lib/lead-store.ts', import.meta.url).href;
// Match the current route imports exactly, including the mocked persistence boundary.
// The shared --import loader resolves the builder's transitive TS dependencies.
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL === routeUrl) {
      if (specifier === '../../../lib/lead-store') return nextResolve(storeUrl, context);
      if (specifier === '../../api/contact/slack-message') return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});
const tasks = [];
const verify = mock.fn(async () => true);
const getToken = mock.fn(async () => 'test-token');
const saved = {
  id: 'lead-12345678-1234-4234-8234-123456789abc', createdAt: 1789000000, updatedAt: 1789000200,
  submission: contactSubmissionSchema.parse({
    name: 'Jane Doe', email: 'jane@example.com', company: 'Acme', teamSize: '11–50', budget: '$30,000–$50,000',
    message: 'Help furnish our NYC office.\nWe have two teams.',
  }),
  enrichment: {
    status: 'complete', sessionId: 'session_replay-123', createdAt: 1789000000,
    research: researchResultSchema.parse({
      companyDescription: 'Acme designs software in a premium Manhattan office.',
      match: 'matched', nycOffice: 'confirmed', premiumOffice: 'strong',
      purchaseIntent: 'explicit', confidence: 'high',
      rationale: 'An explicit furniture request for its premium NYC office.',
      sources: [{ title: 'Acme offices', url: 'https://example.com/acme/offices' }],
    }),
  },
};
const enrichLead = mock.fn(async () => { throw new Error('Opening details must never start research'); });
const getLead = mock.fn(async () => saved);
const runDemoReplies = mock.fn(async () => {});
mock.module(new URL('../lib/demo-trigger.ts', import.meta.url).href, { exports: { matchDemoTrigger, runDemoReplies } });
mock.module(storeUrl, { exports: { getLead } });
mock.module(new URL('../lib/lead-enrichment.ts', import.meta.url).href, { exports: { enrichLead } });
mock.module('@vercel/connect', { exports: { getToken } });
mock.module('@vercel/connect/chat', { exports: { createConnectWebhookVerifier: () => verify } });
mock.module('next/server.js', { exports: { after: (callback) => tasks.push(callback) } });
const { POST } = await import(routeUrl);
hooks.deregister();

const event = {
  type: 'event_callback', api_app_id: demoConfig.slackAppId, team_id: demoConfig.slackTeamId, event_id: 'EvDemo',
  event: {
    type: 'entity_details_requested', user: 'U123', trigger_id: 'trigger-demo',
    external_ref: { id: saved.id, type: 'lead' },
    entity_url: `https://example.com/demo/leads/${saved.id}`,
  },
};
function request(body = event) {
  return new Request('https://demo.example/triggers/slack', {
    method: 'POST', headers: { Authorization: 'Bearer forwarded-test-token', 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}
beforeEach((t) => {
  tasks.length = 0;
  runDemoReplies.mock.resetCalls();
  runDemoReplies.mock.mockImplementation(async () => {});
  verify.mock.resetCalls();
  verify.mock.mockImplementation(async () => true);
  getToken.mock.resetCalls();
  getToken.mock.mockImplementation(async () => 'test-token');
  enrichLead.mock.resetCalls();
  getLead.mock.resetCalls();
  getLead.mock.mockImplementation(async () => saved);
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected network request'); });
});
afterEach(() => {
  assert.equal(enrichLead.mock.callCount(), 0, 'opening or refreshing details must only read the saved lead');
});

test('requires verified Connect forwarding before handling any payload', async () => {
  verify.mock.mockImplementation(async () => false);
  assert.equal((await POST(request())).status, 401);
  verify.mock.mockImplementation(async () => { throw new Error('Bad JWT'); });
  assert.equal((await POST(request({ type: 'url_verification', challenge: 'challenge' }))).status, 401);
  assert.equal(tasks.length, 0);
  assert.equal(getToken.mock.callCount(), 0);
});

test('passes the original request and raw body to the verifier', async () => {
  const incoming = request();
  await POST(incoming);
  assert.equal(verify.mock.calls[0].arguments[0], incoming);
  assert.equal(verify.mock.calls[0].arguments[1], JSON.stringify(event));
});

test('answers a verified URL challenge without a Slack API call', async () => {
  const response = await POST(request({ type: 'url_verification', challenge: 'challenge' }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { challenge: 'challenge' });
  assert.equal(tasks.length, 0);
});

test('rejects malformed payloads and incomplete detail requests', async () => {
  for (const body of ['{invalid', {}, { ...event, event: { type: 'entity_details_requested' } }]) {
    assert.equal((await POST(request(body))).status, 400);
  }
  assert.equal(tasks.length, 0);
});

test('does not serve another app or workspace', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Cross-app request must not reach Slack'); });
  for (const body of [{ ...event, api_app_id: 'AOTHER' }, { ...event, team_id: 'TOTHER' }]) {
    const response = await POST(request(body));
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: 'Wrong Slack app or workspace' });
  }
  assert.equal(tasks.length, 0);
  assert.equal(getLead.mock.callCount(), 0);
  assert.equal(getToken.mock.callCount(), 0);
  assert.equal(fetchMock.mock.callCount(), 0);
});

test('acknowledges unrelated subscribed events without side effects', async () => {
  assert.equal((await POST(request({ ...event, event: { type: 'app_mention' } }))).status, 200);
  assert.equal(tasks.length, 0);
});

const kickoff = (overrides = {}) => ({
  ...event,
  event: {
    type: 'message', channel_type: 'channel', user: demoConfig.slackTriggerUser,
    channel: 'COTHERPUBLIC', ts: '1789000200.123456', text: scenes.seed[0].text, ...overrides,
  },
});

for (const scene of ['seed', 'playbook']) {
  test(`${scene}: verifies the kickoff before scheduling and acknowledges before selected threaded replies`, async () => {
    for (const channel of ['COTHERPUBLIC', 'CSECONDPUBLIC']) {
      const started = Promise.withResolvers();
      const verified = Promise.withResolvers();
      verify.mock.mockImplementation(async () => { started.resolve(); return verified.promise; });
      const callsBefore = runDemoReplies.mock.callCount();
      const text = ` \n${scenes[scene][0].text.replaceAll(' ', '\t\n').replaceAll('’', "'")}  `;
      const body = kickoff({ channel, text });
      const incoming = request(body);
      const pendingResponse = POST(incoming);
      await started.promise;
      assert.equal(tasks.length, 0, 'verification must finish before scheduling');
      assert.equal(runDemoReplies.mock.callCount(), callsBefore);
      verified.resolve(true);
      const response = await pendingResponse;
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { ok: true });
      assert.deepEqual(verify.mock.calls.at(-1).arguments, [incoming, JSON.stringify(body)]);
      assert.equal(tasks.length, 1);
      assert.equal(runDemoReplies.mock.callCount(), callsBefore, 'acknowledgment precedes worker execution');
      await tasks.pop()();
      assert.equal(runDemoReplies.mock.callCount(), callsBefore + 1);
      assert.deepEqual(runDemoReplies.mock.calls.at(-1).arguments, [{
        scene, channel, ts: '1789000200.123456', user: demoConfig.slackTriggerUser,
      }]);
    }
    assert.equal(getLead.mock.callCount(), 0);
    assert.equal(getToken.mock.callCount(), 0);
  });
}

for (const scene of ['seed', 'playbook']) {
  test(`${scene}: ordinary messages, other users, bots, edits, private channels and thread replies do not schedule`, async () => {
    for (const overrides of [
      { text: 'hello' }, { user: 'UNOTMATT' }, { user: undefined },
      { bot_id: 'BTEST' }, { app_id: 'ATEST' }, { subtype: 'bot_message' }, { hidden: false },
      { subtype: 'message_changed' }, { edited: { user: demoConfig.slackTriggerUser, ts: '1789000300.000001' } },
      { thread_ts: '1789000000.000001' }, { subtype: null }, { edited: null },
      { channel_type: 'group' }, { channel_type: 'im' }, { channel_type: 'mpim' },
      { channel: 'GPRIVATE' }, { channel: 'DDIRECT' },
    ]) {
      assert.equal((await POST(request(kickoff({ text: scenes[scene][0].text, ...overrides })))).status, 200);
    }
    assert.equal(tasks.length, 0);
    assert.equal(runDemoReplies.mock.callCount(), 0);
    assert.equal(getLead.mock.callCount(), 0);
    assert.equal(getToken.mock.callCount(), 0);
  });

  test(`${scene}: kickoff cannot bypass Connect verification, workspace, app or callback checks`, async () => {
    const body = kickoff({ text: scenes[scene][0].text });
    verify.mock.mockImplementation(async () => false);
    assert.equal((await POST(request(body))).status, 401);
    verify.mock.mockImplementation(async () => { throw new Error('Bad JWT'); });
    assert.equal((await POST(request(body))).status, 401);
    verify.mock.mockImplementation(async () => true);
    for (const overrides of [{ team_id: 'TOTHER' }, { api_app_id: 'AOTHER' }]) {
      assert.equal((await POST(request({ ...body, ...overrides }))).status, 403);
    }
    for (const field of ['team_id', 'api_app_id']) {
      const missing = { ...body };
      delete missing[field];
      assert.equal((await POST(request(missing))).status, 400);
    }
    assert.equal((await POST(request({ ...body, type: 'not_event_callback' }))).status, 200);
    assert.equal(tasks.length, 0);
    assert.equal(runDemoReplies.mock.callCount(), 0);
    assert.equal(getLead.mock.callCount(), 0);
    assert.equal(getToken.mock.callCount(), 0);
  });
}

test('website kickoff is acknowledged without scheduling any demo, even with an allowlisted scene field', async () => {
  for (const scene of [undefined, 'seed', 'playbook', 'website']) {
    for (const text of [scenes.website[0].text, ` \n${scenes.website[0].text.replaceAll(' ', '\t\n')} `]) {
      assert.equal((await POST(request(kickoff({ text, scene })))).status, 200);
    }
  }
  assert.equal(tasks.length, 0);
  assert.equal(runDemoReplies.mock.callCount(), 0);
  assert.equal(getLead.mock.callCount(), 0);
  assert.equal(getToken.mock.callCount(), 0);
});

test('kickoff worker failures are caught after acknowledgment without logging private details', async (t) => {
  runDemoReplies.mock.mockImplementation(async () => { throw new Error('sensitive-token-value'); });
  const log = t.mock.method(console, 'error', () => {});
  assert.equal((await POST(request(kickoff()))).status, 200);
  await assert.doesNotReject(tasks.pop());
  assert.equal(log.mock.callCount(), 1);
  assert.ok(!JSON.stringify(log.mock.calls).includes('sensitive-token-value'));
});

test('acks before reading KV and presents the original submission with its stored identity and enrichment', async (t) => {
  const started = Promise.withResolvers();
  const read = Promise.withResolvers();
  const original = structuredClone(saved);
  t.after(() => read.resolve(saved));
  getLead.mock.mockImplementation((id) => {
    started.resolve(id);
    return read.promise;
  });
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => Response.json({ ok: true }));
  const response = await POST(request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(tasks.length, 1);
  assert.equal(getLead.mock.callCount(), 0);
  assert.equal(getToken.mock.callCount(), 0);
  assert.equal(fetchMock.mock.callCount(), 0);
  const delivery = tasks.pop()();
  assert.equal(await started.promise, saved.id);
  await new Promise(setImmediate);
  assert.equal(fetchMock.mock.callCount(), 0, 'details must wait for the saved record');
  read.resolve(saved);
  await delivery;
  assert.equal(getLead.mock.callCount(), 1);
  assert.deepEqual(getLead.mock.calls[0].arguments, [saved.id]);
  assert.deepEqual(getToken.mock.calls[0].arguments, ['slack/dreamforce-landing-page', {
    subject: { type: 'app' }, installationId: demoConfig.slackTeamId,
  }]);
  assert.equal(fetchMock.mock.callCount(), 1);
  const [url, options] = fetchMock.mock.calls[0].arguments;
  assert.equal(url, 'https://slack.com/api/entity.presentDetails');
  assert.equal(options.method, 'POST');
  assert.equal(options.headers.Authorization, 'Bearer test-token');
  const body = JSON.parse(options.body);
  assert.equal(body.trigger_id, event.event.trigger_id);
  assert.equal(body.error, undefined);
  assert.equal(body.metadata.entity_type, 'slack#/entities/item');
  assert.deepEqual(body.metadata.external_ref, event.event.external_ref);
  assert.equal(body.metadata.url, event.event.entity_url);
  assert.equal(body.metadata.entities, undefined, 'details metadata is a single entity, not an array');
  assert.equal(body.metadata.entity_payload.attributes.metadata_last_modified, saved.updatedAt);
  const fields = Object.fromEntries(body.metadata.entity_payload.custom_fields.map((field) => [field.key, field.value]));
  assert.deepEqual(fields, {
    full_name: saved.submission.name, company: saved.submission.company, team_size: saved.submission.teamSize,
    budget: saved.submission.budget, status: 'New', description: saved.submission.message, source: 'Contact Us Form',
    icp_fit: '97/100 · Strong fit', company_overview: saved.enrichment.research.companyDescription,
    fit_reason: saved.enrichment.research.rationale, confidence: 'high',
    research_source_0: saved.enrichment.research.sources[0].url,
  });
  assert.deepEqual(body.metadata.entity_payload.custom_fields.find(({ key }) => key === 'budget'), {
    key: 'budget', label: 'Budget (USD)', type: 'string', value: saved.submission.budget,
  });
  assert.deepEqual(body.metadata.entity_payload.display_order, [
    'full_name', 'company', 'budget', 'icp_fit', 'company_overview', 'fit_reason', 'confidence',
    'team_size', 'status', 'description', 'source', 'research_source_0',
  ]);
  assert.deepEqual(body.metadata.entity_payload.custom_fields.find(({ key }) => key === 'research_source_0'), {
    key: 'research_source_0', label: 'Acme offices', type: 'slack#/types/link', value: saved.enrichment.research.sources[0].url,
  });

  // A refresh reads the same record, never launching another research turn.
  assert.equal((await POST(request())).status, 200);
  assert.equal(tasks.length, 1);
  await tasks.pop()();
  assert.equal(getLead.mock.callCount(), 2);
  assert.deepEqual(getLead.mock.calls[1].arguments, [saved.id]);
  assert.equal(fetchMock.mock.callCount(), 2);
  assert.deepEqual(JSON.parse(fetchMock.mock.calls[1].arguments[1].body), body);
  assert.deepEqual(saved, original, 'opening details must not mutate the stored record');
});

test('old demo and Eve identities return not_found without reading KV', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => Response.json({ ok: true }));
  for (const id of ['demo-12345678', `eve-${saved.enrichment.sessionId}`]) {
    const response = await POST(request({ ...event, event: {
      ...event.event, external_ref: { id, type: 'lead' },
      entity_url: `https://example.com/demo/leads/${id}`,
    } }));
    assert.equal(response.status, 200);
    assert.equal(tasks.length, 1);
    await tasks.pop()();
    assert.deepEqual(JSON.parse(fetchMock.mock.calls.at(-1).arguments[1].body), {
      trigger_id: event.event.trigger_id, error: { status: 'not_found' },
    });
  }
  assert.equal(getLead.mock.callCount(), 0);
  assert.equal(fetchMock.mock.callCount(), 2);
});

for (const enrichment of [undefined, { status: 'unavailable', createdAt: 1789000100 }]) {
  test(`persisted lead with ${enrichment?.status ?? 'pending'} enrichment shows all submitted display fields`, async (t) => {
    const unscored = { ...saved, enrichment };
    getLead.mock.mockImplementation(async () => unscored);
    const fetchMock = t.mock.method(globalThis, 'fetch', async () => Response.json({ ok: true }));
    assert.equal((await POST(request())).status, 200);
    await tasks.pop()();
    assert.deepEqual(getLead.mock.calls[0].arguments, [saved.id]);
    const body = JSON.parse(fetchMock.mock.calls[0].arguments[1].body);
    assert.equal(body.error, undefined);
    assert.deepEqual(body.metadata.external_ref, { id: saved.id, type: 'lead' });
    assert.equal(body.metadata.entity_payload.attributes.metadata_last_modified, saved.updatedAt);
    const fields = Object.fromEntries(body.metadata.entity_payload.custom_fields.map((field) => [field.key, field.value]));
    assert.deepEqual(fields, {
      full_name: saved.submission.name, company: saved.submission.company, team_size: saved.submission.teamSize,
      budget: saved.submission.budget, status: 'New', description: saved.submission.message, source: 'Contact Us Form',
      icp_fit: '42/100 · Low fit', confidence: enrichment ? 'Unavailable' : 'Pending',
    });
    assert.deepEqual(unscored.submission, saved.submission);
  });
}

test('legacy details show Not provided and still score saved signals without guessing a budget', async (t) => {
  const legacy = structuredClone(saved);
  delete legacy.submission.budget;
  const original = structuredClone(legacy);
  getLead.mock.mockImplementation(async () => legacy);
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => Response.json({ ok: true }));
  assert.equal((await POST(request())).status, 200);
  await tasks.pop()();
  assert.deepEqual(getLead.mock.calls[0].arguments, [saved.id]);
  const body = JSON.parse(fetchMock.mock.calls[0].arguments[1].body);
  assert.equal(body.error, undefined);
  assert.deepEqual(body.metadata.external_ref, event.event.external_ref);
  const { custom_fields, display_order } = body.metadata.entity_payload;
  assert.deepEqual(custom_fields.find(({ key }) => key === 'budget'), {
    key: 'budget', label: 'Budget (USD)', type: 'string', value: 'Not provided',
  });
  assert.ok(display_order.includes('budget'));
  assert.equal(custom_fields.find(({ key }) => key === 'icp_fit').value, '57/100 · Possible fit');
  assert.equal(JSON.stringify(body).includes(saved.submission.budget), false);
  assert.equal(JSON.stringify(body).includes('Not sure yet'), false);
  assert.equal(Object.hasOwn(legacy.submission, 'budget'), false);
  assert.deepEqual(legacy, original);
});

test('missing saved record returns not_found without fake metadata', async (t) => {
  getLead.mock.mockImplementation(async () => null);
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => Response.json({ ok: true }));
  assert.equal((await POST(request())).status, 200);
  await tasks.pop()();
  assert.equal(getLead.mock.callCount(), 1);
  assert.deepEqual(getLead.mock.calls[0].arguments, [saved.id]);
  assert.equal(fetchMock.mock.callCount(), 1);
  assert.deepEqual(JSON.parse(fetchMock.mock.calls[0].arguments[1].body), {
    trigger_id: event.event.trigger_id, error: { status: 'not_found' },
  });
});

test('unavailable KV returns a retryable custom error without starting new research', async (t) => {
  getLead.mock.mockImplementation(async () => { throw new Error(`private-kv-error: ${saved.submission.email}`); });
  const log = t.mock.method(console, 'error', () => {});
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => Response.json({ ok: true }));
  assert.equal((await POST(request())).status, 200);
  await assert.doesNotReject(tasks.pop());
  assert.equal(getLead.mock.callCount(), 1);
  assert.deepEqual(getLead.mock.calls[0].arguments, [saved.id]);
  assert.equal(fetchMock.mock.callCount(), 1);
  const body = JSON.parse(fetchMock.mock.calls[0].arguments[1].body);
  assert.deepEqual(body, {
    trigger_id: event.event.trigger_id,
    error: {
      status: 'custom', custom_title: 'Lead temporarily unavailable',
      custom_message: 'The saved lead could not be loaded. Please refresh this panel to try again.',
    },
  });
  assert.equal(JSON.stringify([body, log.mock.calls]).includes('private-kv-error'), false);
  assert.equal(JSON.stringify([body, log.mock.calls]).includes(saved.submission.email), false);
});

test('returns not_found for unsupported identities, types, and URLs', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => Response.json({ ok: true }));
  const unsupported = [
    ...['real-lead-1', 'eve-', 'eve-session/other', `eve-${'a'.repeat(181)}`].map((id) => ({
      ...event.event, external_ref: { id, type: 'lead' },
      entity_url: `https://example.com/demo/leads/${encodeURIComponent(id)}`,
    })),
    { ...event.event, external_ref: { ...event.event.external_ref, type: 'other' } },
    { ...event.event, entity_url: 'https://unrelated.example/lead' },
    { ...event.event, entity_url: 'https://example.com/demo/leads/eve-another-session' },
    { ...event.event, entity_url: `${event.event.entity_url}?session=other` },
  ];
  for (const details of unsupported) {
    const response = await POST(request({ ...event, event: details }));
    assert.equal(response.status, 200);
    await tasks.pop()();
    const body = JSON.parse(fetchMock.mock.calls.at(-1).arguments[1].body);
    assert.deepEqual(body.error, { status: 'not_found' });
    assert.equal(body.metadata, undefined);
    assert.equal(body.trigger_id, details.trigger_id);
  }
  assert.equal(getLead.mock.callCount(), 0, 'reject invalid references before accessing KV');
  assert.equal(fetchMock.mock.callCount(), unsupported.length);
});

test('handles Slack API rejection after acknowledgment without unhandled failures', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ ok: false, error: 'invalid_trigger_id' }));
  const log = t.mock.method(console, 'error', () => {});
  assert.equal((await POST(request())).status, 200);
  await assert.doesNotReject(tasks[0]);
  assert.equal(log.mock.callCount(), 1);
});

test('handles credential failure without leaking details into logs', async (t) => {
  getToken.mock.mockImplementation(async () => { throw new Error('sensitive-token-value'); });
  const log = t.mock.method(console, 'error', () => {});
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => { throw new Error('unexpected fetch'); });
  await POST(request());
  await assert.doesNotReject(tasks[0]);
  assert.equal(fetchMock.mock.callCount(), 0);
  assert.ok(!JSON.stringify(log.mock.calls).includes('sensitive-token-value'));
});
