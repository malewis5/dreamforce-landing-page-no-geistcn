import assert from 'node:assert/strict';
import { after, mock, test } from 'node:test';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { z } from 'zod';
import { researchResultSchema } from '../lib/lead-research.ts';
import { BUDGETS, contactSubmissionSchema } from '../lib/contact.ts';

const forbidden = () => assert.fail('Unexpected model, network, or mutating session call');
const oidcToken = mock.fn(forbidden);
class StubClient {
  constructor(options) {
    this.options = options;
    this.sessions = { create: forbidden, attach: forbidden, send: forbidden };
  }
}
const eveMock = mock.module('eve/client', { namedExports: { Client: StubClient } });
const oidcMock = mock.module('@vercel/oidc', { namedExports: { getVercelOidcToken: oidcToken } });
after(() => { eveMock.restore(); oidcMock.restore(); });
const { businessEmailDomain, createResearchClient, enrichLead, leadContextSchema } =
  await import('../lib/lead-enrichment.ts');

const lead = {
  name: 'Jordan Lee', company: 'Original Studio', teamSize: '51–200', budget: '$30,000–$50,000',
  message: 'We need furniture for our new NYC office.\nPlease send options.',
};
const input = { ...lead, email: 'jordan@OriginalStudio.com' };
const research = {
  companyDescription: 'A design studio with a Manhattan headquarters.',
  match: 'matched', nycOffice: 'confirmed', premiumOffice: 'strong',
  purchaseIntent: 'explicit', confidence: 'high', rationale: 'The office page supports the fit.',
  sources: [{ title: 'Office', url: 'https://example.com/office' }],
};
const envelope = {
  kind: 'framing-display-lead.v1', lead, businessDomain: 'originalstudio.com', createdAt: 123,
};
function creation(result = async () => ({ status: 'completed', data: research })) {
  const session = { state: { sessionId: 'research_123' }, cancel: mock.fn(async () => {}) };
  const response = { result: mock.fn(result) };
  const create = mock.fn(async () => ({ session, response }));
  return { session, response, create, client: { sessions: { create, attach: forbidden, send: forbidden } } };
}
function assertUnavailable(value) {
  assert.deepEqual(Object.keys(value).sort(), ['createdAt', 'status']);
  assert.equal(value.status, 'unavailable');
  assert.ok(Number.isInteger(value.createdAt) && value.createdAt >= 0);
}
function assertCancelled(session) {
  assert.equal(session.cancel.mock.callCount(), 1);
  const [options] = session.cancel.mock.calls[0].arguments;
  assert.equal(options.tasks, true);
  assert.ok(options.signal instanceof AbortSignal);
}
// A ref'ed watchdog also keeps Node alive for AbortSignal.timeout's unref'ed timer.
async function bounded(work) {
  let timer;
  try {
    return await Promise.race([work, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Operation exceeded the 1s test bound')), 1_000);
    })]);
  } finally { clearTimeout(timer); }
}

test('structured research sends original display context, domain, schema and signal, never full email', async () => {
  const stub = creation();
  const before = structuredClone(input);
  const result = await enrichLead(input, { client: stub.client });
  assert.equal(stub.create.mock.callCount(), 1);
  const [options] = stub.create.mock.calls[0].arguments;
  const sent = JSON.parse(options.message);
  assert.deepEqual(sent, { ...envelope, createdAt: result.createdAt });
  assert.ok(Number.isInteger(sent.createdAt) && sent.createdAt >= 0);
  assert.equal(options.message.includes(input.email), false);
  assert.equal(Object.hasOwn(sent.lead, 'email'), false);
  assert.ok(options.signal instanceof AbortSignal);
  assert.equal(options.signal.aborted, false);
  assert.deepEqual(options.outputSchema, z.toJSONSchema(researchResultSchema));
  assert.deepEqual(options.streamReconnectPolicy, { reconnect: false });
  assert.deepEqual(result, {
    status: 'complete', sessionId: stub.session.state.sessionId, createdAt: sent.createdAt, research,
  });
  assert.equal(stub.response.result.mock.callCount(), 1);
  assert.equal(stub.session.cancel.mock.callCount(), 0);
  assert.deepEqual(input, before);
});

test('all budget options pass the shared context schema and travel unchanged in the agent prompt', async () => {
  for (const budget of BUDGETS) {
    const submission = { ...input, budget };
    const context = leadContextSchema.parse(contactSubmissionSchema.parse(submission));
    assert.deepEqual(context, { ...lead, budget });
    const stub = creation();
    assert.equal((await enrichLead(submission, { client: stub.client })).status, 'complete');
    assert.deepEqual(JSON.parse(stub.create.mock.calls[0].arguments[0].message).lead, context);
  }
});

test('shared context rejects missing or invalid budget before creating an Eve session', async () => {
  const { budget: _budget, ...missingBudget } = input;
  for (const submission of [missingBudget, { ...input, budget: 'Select budget' }]) {
    assert.equal(contactSubmissionSchema.safeParse(submission).success, false);
    assert.equal(leadContextSchema.safeParse(submission).success, false);
    const stub = creation();
    assertUnavailable(await enrichLead(submission, { client: stub.client }));
    assert.equal(stub.create.mock.callCount(), 0);
    assert.equal(stub.session.cancel.mock.callCount(), 0);
  }
});

test('personal domain filtering is deterministic, case insensitive and exact', async () => {
  for (const domain of [
    'gmail.com', 'googlemail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'live.com',
    'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com',
  ]) {
    for (const email of [`person@${domain}`, `OTHER@${domain.toUpperCase()}`]) {
      assert.equal(businessEmailDomain(email), null, email);
      const stub = creation();
      assert.equal((await enrichLead({ ...input, email }, { client: stub.client })).status, 'complete');
      assert.equal(JSON.parse(stub.create.mock.calls[0].arguments[0].message).businessDomain, null);
    }
  }
  for (const [email, expected] of [
    ['a@OriginalStudio.COM', 'originalstudio.com'], ['b@originalstudio.com', 'originalstudio.com'],
    ['a@office.gmail.com', 'office.gmail.com'], ['a@notgmail.com', 'notgmail.com'],
  ]) assert.equal(businessEmailDomain(email), expected);
});

for (const [label, result] of [
  ['schema validation failure', async () => ({ status: 'completed', data: { ...research, companyDescription: '' } })],
  ['failed status even with valid data', async () => ({ status: 'failed', data: research })],
  ['result rejection', async () => { throw new Error('Result failed'); }],
]) {
  test(`${label} returns unavailable and cancels once`, async () => {
    const stub = creation(result);
    assertUnavailable(await enrichLead(input, { client: stub.client }));
    assertCancelled(stub.session);
  });
}

test('creation rejection returns unavailable without a session', async () => {
  const stub = creation();
  stub.create.mock.mockImplementation(async () => { throw new Error('Create failed'); });
  assertUnavailable(await enrichLead(input, { client: stub.client }));
  assert.equal(stub.session.cancel.mock.callCount(), 0);
});

test('cancellation rejection does not replace the unavailable fallback', async () => {
  const stub = creation(async () => ({ status: 'failed' }));
  stub.session.cancel.mock.mockImplementation(async () => { throw new Error('Cancel failed'); });
  assertUnavailable(await enrichLead(input, { client: stub.client }));
  assertCancelled(stub.session);
});

test('result timeout is bounded and late failure cannot cancel twice', async () => {
  const pending = Promise.withResolvers();
  const stub = creation(() => pending.promise);
  const result = await bounded(enrichLead(input, { client: stub.client, timeoutMs: 10 }));
  assertUnavailable(result);
  assert.equal(stub.create.mock.calls[0].arguments[0].signal.aborted, true);
  assertCancelled(stub.session);
  pending.reject(new Error('Late result failure'));
  await nextTurn();
  assertCancelled(stub.session);
});

test('creation timeout returns promptly and cancels a late-created session once', async () => {
  const pending = Promise.withResolvers();
  const stub = creation();
  stub.create.mock.mockImplementation(() => pending.promise);
  assertUnavailable(await bounded(enrichLead(input, { client: stub.client, timeoutMs: 10 })));
  assert.equal(stub.create.mock.calls[0].arguments[0].signal.aborted, true);
  assert.equal(stub.session.cancel.mock.callCount(), 0);
  pending.resolve({ session: stub.session, response: stub.response });
  await nextTurn();
  assertCancelled(stub.session);
  assert.equal(stub.response.result.mock.callCount(), 0);
});

test('client uses trusted origin configuration, rejects unsafe origins and keeps OIDC lazy', (t) => {
  const keys = ['EVE_AGENT_ORIGIN', 'VERCEL_URL', 'PORT', 'VERCEL', 'NODE_ENV'];
  const original = keys.map((key) => [key, process.env[key]]);
  t.after(() => {
    for (const [key, value] of original) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  function configure(env) {
    for (const key of keys) delete process.env[key];
    Object.assign(process.env, env);
  }
  for (const [env, host, auth] of [
    [{}, 'http://127.0.0.1:3000', false],
    [{ PORT: '4321' }, 'http://127.0.0.1:4321', false],
    [{ VERCEL_URL: 'deployment.example.com' }, 'https://deployment.example.com', true],
    [{ EVE_AGENT_ORIGIN: 'https://trusted.example.com:8443', VERCEL_URL: 'ignored.example.com' }, 'https://trusted.example.com:8443', true],
    [{ EVE_AGENT_ORIGIN: 'http://localhost:4321' }, 'http://localhost:4321', false],
    [{ EVE_AGENT_ORIGIN: 'http://[::1]:4321' }, 'http://[::1]:4321', false],
    [{ EVE_AGENT_ORIGIN: 'http://localhost:4321', VERCEL: '1' }, 'http://localhost:4321', true],
    [{ EVE_AGENT_ORIGIN: 'http://localhost:4321', NODE_ENV: 'production' }, 'http://localhost:4321', true],
  ]) {
    configure(env);
    assert.deepEqual(createResearchClient().options, {
      host, redirect: 'error', ...(auth ? { auth: { vercelOidc: { token: oidcToken } } } : {}),
    });
  }
  for (const origin of [
    'http://remote.example.com', 'ftp://localhost', 'https://user:pass@example.com',
    'https://example.com/path', 'https://example.com/?query=1', 'https://example.com/#fragment',
    'http://localhost.evil.example.com', 'not a URL',
  ]) {
    configure({ EVE_AGENT_ORIGIN: origin });
    assert.throws(() => createResearchClient(), undefined, origin);
  }
  assert.equal(oidcToken.mock.callCount(), 0);
});
