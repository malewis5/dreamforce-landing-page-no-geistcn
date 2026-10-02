import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
import demoConfig from '../demo.config.json' with { type: 'json' };
import { scenes } from '../scripts/demo-scenes.mjs';
import { buildMessage, target } from '../lib/demo-runner.mjs';

const getToken = mock.fn();
const fromEnv = mock.fn();
mock.module('@vercel/connect', { namedExports: { getToken } });
mock.module('@upstash/redis', { namedExports: { Redis: { fromEnv } } });
const { matchDemoTrigger, runDemoReplies } = await import('../lib/demo-trigger.ts');

const event = (overrides = {}) => ({
  type: 'message', channel_type: 'channel', channel: demoConfig.slackChannel,
  user: 'UPRESENTER', ts: '1789000000.123456', text: scenes.seed[0].text,
  ...overrides,
});
const trigger = (overrides) => matchDemoTrigger(event(overrides));
const keyFor = (value) => `dreamforce:demo-trigger:${target.team}:${value.channel}:${value.ts}`;
const genericFailure = { message: 'Demo replies failed; inspect stored delivery state before retrying.' };

function harness() {
  const records = new Map();
  const writes = [];
  const calls = [];
  const tokens = [];
  const delays = [];
  const store = {
    async set(key, value, options) {
      writes.push({ key, value: structuredClone(value), options });
      if (options?.nx && records.has(key)) return null;
      records.set(key, structuredClone(value));
      return 'OK';
    },
  };
  const options = {
    store,
    getToken: async (...args) => {
      assert.equal(writes.at(-1).options?.nx, true, 'claim precedes token lookup');
      assert.equal(records.get(writes.at(-1).key).status, 'running');
      tokens.push(args);
      return 'fake-token';
    },
    call: async (token, method, body) => {
      assert.equal(token, 'fake-token');
      calls.push({ method, body });
      if (method === 'conversations.info') {
        assert.equal(records.get(writes.at(-1).key).status, 'running');
        return { data: { channel: { id: body.channel, is_private: false, is_archived: false } } };
      }
      assert.equal(method, 'chat.postMessage', 'no joins, history, or other Slack methods');
      const state = records.get(keyFor({ channel: body.channel, ts: body.thread_ts }));
      const posts = calls.filter((call) => call.method === 'chat.postMessage'
        && call.body.channel === body.channel && call.body.thread_ts === body.thread_ts);
      assert.equal(state.status, 'needs-review');
      assert.equal(state.pending, posts.length - 1, 'pending index is durable before each post');
      return { data: { channel: body.channel, ts: `${calls.length}.000`, message: { thread_ts: body.thread_ts } } };
    },
    wait: async (ms, signal) => { assert.equal(signal.aborted, false); delays.push(ms); },
  };
  return { records, writes, calls, tokens, delays, options };
}

beforeEach((t) => {
  getToken.mock.resetCalls();
  fromEnv.mock.resetCalls();
  getToken.mock.mockImplementation(async () => { throw new Error('Unexpected token lookup'); });
  fromEnv.mock.mockImplementation(() => { throw new Error('Unexpected Redis access'); });
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected network request'); });
});

for (const scene of ['seed', 'playbook']) {
  test(`${scene}: matches exact kickoff from any human in the configured channel`, () => {
    const opener = scenes[scene][0].text;
    for (const user of ['UPRESENTER', 'UOTHER']) {
      for (const text of [opener, ` \n${opener.replaceAll(' ', '\t\n').replaceAll('’', "'")}  `,
        opener.replaceAll('’', '‘')]) {
        assert.deepEqual(matchDemoTrigger(event({ user, text })), {
          scene, channel: demoConfig.slackChannel, user, ts: '1789000000.123456',
        });
      }
      assert.equal(matchDemoTrigger(event({ user, text: opener, scene: 'website' })).scene, scene,
        'scene is derived from allowlisted text, not inbound metadata');
    }
  });
}

test('the Services kickoff replaces the retired furniture kickoff', () => {
  assert.match(scenes.seed[0].text, /Services section/);
  assert.ok(matchDemoTrigger(event()));
  assert.equal(matchDemoTrigger(event({ user: 'UOTHER' }))?.user, 'UOTHER');
  assert.equal(matchDemoTrigger(event({ channel: 'COTHERPUBLIC' })), null);
  assert.equal(matchDemoTrigger(event({ text: 'Another inquiry for a single desk this morning. We’re getting a lot of these, but the projects we’re best at are furnishing whole offices. Are we setting the right expectation on the website?' })), null);
});

test('rejects the website kickoff and every non-kickoff scene line, even with forged scene metadata', () => {
  const lines = [...scenes.website, ...scenes.seed.slice(1), ...scenes.playbook.slice(1)];
  for (const { text } of lines) {
    for (const scene of [undefined, 'seed', 'playbook', 'website']) {
      assert.equal(matchDemoTrigger(event({ text, scene })), null);
      assert.equal(matchDemoTrigger(event({ text: ` \n${text.replaceAll(' ', '\t\n')} `, scene })), null);
    }
  }
});

for (const scene of ['seed', 'playbook']) {
  test(`${scene}: rejects nonhuman, private, DM, threaded, edited, partial, and malformed events`, () => {
    const opener = scenes[scene][0].text;
    const message = (overrides = {}) => event({ text: opener, ...overrides });
    for (const value of [null, undefined, [], true, 'message', {}, ...[
      { type: 'app_mention' }, { channel_type: 'group' }, { channel_type: 'im' }, { channel_type: 'mpim' },
      { user: 'not-a-user' }, { user: undefined }, { channel: 'COTHERPUBLIC' }, { channel: 'GPRIVATE' }, { channel: 'DDIRECT' },
      { channel: 'Cbad' }, { channel: 'C' }, { channel: 'C123:bad' }, { channel: 123 },
      { ts: undefined }, { ts: 123 }, { ts: '123' }, { ts: '123.456:bad' },
      { subtype: 'message_changed' }, { subtype: 'message_deleted' }, { subtype: 'bot_message' },
      { text: opener.slice(0, -1) }, { text: `prefix ${opener}` },
      { text: `${opener} extra` }, { text: opener.toLowerCase() },
      { text: '' }, { text: null },
    ].map(message)]) assert.equal(matchDemoTrigger(value), null, JSON.stringify(value));
    for (const field of ['subtype', 'bot_id', 'app_id', 'hidden', 'thread_ts', 'edited']) {
      for (const value of [undefined, null, false, '', 'present']) {
        assert.equal(matchDemoTrigger(message({ [field]: value })), null, `${field}: ${value}`);
      }
    }
    for (const field of ['type', 'channel_type', 'channel', 'user', 'ts', 'text']) {
      const value = message();
      delete value[field];
      assert.equal(matchDemoTrigger(value), null, field);
    }
  });
}

test('worker guards scene/user/channel/ts before storage or external side effects', async () => {
  const h = harness();
  const omittedScene = { ...trigger() };
  delete omittedScene.scene;
  const invalid = [null, {}, omittedScene,
    ...[undefined, null, '', 'website', 'unknown', 'SEED', 'toString', '__proto__', 123, ['seed'], {}]
      .map((scene) => ({ ...trigger(), scene }))];
  for (const scene of ['seed', 'playbook']) {
    for (const overrides of [{ user: 'not-a-user' }, { user: undefined }, { channel: 'COTHERPUBLIC' }, { channel: 'GPRIVATE' },
      { channel: 'DDIRECT' }, { ts: 'invalid' }]) {
      invalid.push({ ...trigger(), scene, ...overrides });
    }
  }
  for (const value of invalid) {
    await assert.rejects(runDemoReplies(value), /Invalid demo trigger/);
    await assert.rejects(runDemoReplies(value, h.options), /Invalid demo trigger/);
  }
  assert.equal(h.writes.length, 0);
  assert.equal(h.tokens.length, 0);
  assert.equal(h.calls.length, 0);
  assert.equal(fromEnv.mock.callCount(), 0);
  assert.equal(getToken.mock.callCount(), 0);
});

test('posts only Jordan → Maya → Alex → Sam, in the original thread/channel, persisting each receipt', async () => {
  for (const channel of [demoConfig.slackChannel]) {
    const h = harness();
    const value = trigger({ channel });
    await runDemoReplies(value, h.options);
    assert.deepEqual(h.tokens, [[target.connector, { subject: { type: 'app' }, installationId: target.team }]]);
    assert.deepEqual(h.calls[0], { method: 'conversations.info', body: { channel } });
    const posts = h.calls.slice(1).map(({ body }) => body);
    assert.deepEqual(posts, scenes.seed.slice(1).map((line) => buildMessage(line, value.ts, channel)));
    assert.deepEqual(posts.map((post) => post.username), ['Jordan — Marketing', 'Maya — Sales', 'Alex — Design', 'Sam — Engineering']);
    assert.ok(posts.every((post) => post.thread_ts === value.ts && post.channel === channel
      && post.text !== scenes.seed[0].text && post.reply_broadcast === false));
    assert.deepEqual(h.delays, [3000, 3000, 3000]);
    assert.deepEqual(h.writes[0], {
      key: keyFor(value), value: { status: 'running', receipts: [] }, options: { nx: true },
    });
    assert.equal(h.writes.length, 9);
    assert.deepEqual(h.writes.slice(1).map(({ value: state }) => [state.pending, state.receipts.length, state.status]), [
      [0, 0, 'needs-review'], [undefined, 1, 'running'],
      [1, 1, 'needs-review'], [undefined, 2, 'running'],
      [2, 2, 'needs-review'], [undefined, 3, 'running'],
      [3, 3, 'needs-review'], [undefined, 4, 'complete'],
    ]);
    assert.deepEqual(h.records.get(keyFor(value)), {
      status: 'complete', receipts: [2, 3, 4, 5].map((n) => ({ channel, ts: `${n}.000`, thread_ts: value.ts })),
    });
    await runDemoReplies(value, h.options);
    assert.equal(h.calls.length, 5);
    assert.equal(h.tokens.length, 1);
  }
});

test('a saved custom conversation matches its trigger and posts the selected members and emoji', async () => {
  const conversation = {
    id: '12345678-1234-4234-8234-123456789abc', title: 'Custom preview', enabled: true,
    trigger: 'Could we show a new display?',
    members: [
      { id: 'one', name: 'Nina — Design', emoji: ':art:' },
      { id: 'two', name: 'Sam — Engineering', emoji: ':technologist:' },
    ],
    replies: [
      { memberId: 'one', text: 'I can sketch it.' },
      { memberId: 'two', text: 'I can build it.' },
    ],
  };
  const value = matchDemoTrigger(event({ text: conversation.trigger }), [conversation]);
  assert.deepEqual(value, {
    scene: conversation.id, channel: demoConfig.slackChannel, user: 'UPRESENTER', ts: '1789000000.123456',
  });
  assert.equal(matchDemoTrigger(event({ text: conversation.trigger }), [{ ...conversation, enabled: false }]), null);
  const h = harness();
  await runDemoReplies(value, { ...h.options, conversation });
  assert.deepEqual(h.calls.slice(1).map(({ body }) => [body.username, body.icon_emoji, body.text]), [
    ['Nina — Design', ':art:', 'I can sketch it.'],
    ['Sam — Engineering', ':technologist:', 'I can build it.'],
  ]);
  assert.deepEqual(h.delays, [3000]);
});

test('playbook posts only Sam → Maya → Jordan in the original thread/channel, never duplicating the parent', async () => {
  for (const channel of [demoConfig.slackChannel]) {
    const h = harness();
    const value = trigger({ channel, text: scenes.playbook[0].text });
    await runDemoReplies(value, h.options);
    assert.deepEqual(h.tokens, [[target.connector, { subject: { type: 'app' }, installationId: target.team }]]);
    assert.deepEqual(h.calls[0], { method: 'conversations.info', body: { channel } });
    const posts = h.calls.slice(1).map(({ body }) => body);
    assert.deepEqual(posts, scenes.playbook.slice(1).map((line) => buildMessage(line, value.ts, channel)));
    assert.deepEqual(posts.map((post) => post.username), ['Sam — Engineering', 'Maya — Sales', 'Jordan — Marketing']);
    assert.ok(posts.every((post) => post.thread_ts === value.ts && post.channel === channel
      && post.text !== scenes.playbook[0].text && post.reply_broadcast === false));
    assert.deepEqual(h.delays, [3000, 3000]);
    assert.deepEqual(h.writes[0], {
      key: keyFor(value), value: { status: 'running', receipts: [] }, options: { nx: true },
    });
    assert.equal(h.writes.length, 7);
    assert.deepEqual(h.writes.slice(1).map(({ value: state }) => [state.pending, state.receipts.length, state.status]), [
      [0, 0, 'needs-review'], [undefined, 1, 'running'],
      [1, 1, 'needs-review'], [undefined, 2, 'running'],
      [2, 2, 'needs-review'], [undefined, 3, 'complete'],
    ]);
    assert.deepEqual(h.records.get(keyFor(value)), {
      status: 'complete', receipts: [2, 3, 4].map((n) => ({ channel, ts: `${n}.000`, thread_ts: value.ts })),
    });
    await runDemoReplies(value, h.options);
    assert.equal(h.calls.length, 4);
    assert.equal(h.tokens.length, 1);
  }
});

for (const scene of ['seed', 'playbook']) {
  test(`${scene}: atomic parent claim excludes concurrent duplicates and conflicting scene claims`, async () => {
    const h = harness();
    let release;
    let entered;
    const gate = new Promise((resolve) => { release = resolve; });
    const started = new Promise((resolve) => { entered = resolve; });
    const original = h.options.getToken;
    h.options.getToken = async (...args) => { entered(); await gate; return original(...args); };
    const value = trigger({ text: scenes[scene][0].text });
    const conflict = { ...value, scene: scene === 'seed' ? 'playbook' : 'seed' };
    const first = runDemoReplies(value, h.options);
    await started;
    await Promise.all(Array.from({ length: 12 }, (_, index) => runDemoReplies(index % 2 ? conflict : value, h.options)));
    assert.equal(h.calls.length, 0);
    release();
    await first;
    await runDemoReplies(conflict, h.options);
    await runDemoReplies(value, h.options);
    assert.deepEqual(h.calls.slice(1).map(({ body }) => body),
      scenes[scene].slice(1).map((line) => buildMessage(line, value.ts, value.channel)));
    assert.equal(h.tokens.length, 1);
    assert.equal(h.records.size, 1);
    assert.ok(h.writes.every(({ key }) => key === keyFor(value)), 'scene never enters the dedup key');
  });
}

test('different parent timestamps claim independently for repeated and different scenes', async () => {
  const h = harness();
  const values = ['seed', 'playbook', 'seed', 'playbook'].map((scene, index) =>
    trigger({ text: scenes[scene][0].text, ts: `178900000${index}.123456` }));
  for (const value of values) {
    await runDemoReplies(value, h.options);
    await runDemoReplies(value, h.options);
    const posts = h.calls.filter(({ method, body }) => method === 'chat.postMessage' && body.thread_ts === value.ts);
    assert.deepEqual(posts.map(({ body }) => body),
      scenes[value.scene].slice(1).map((line) => buildMessage(line, value.ts, value.channel)));
    assert.equal(h.records.get(keyFor(value)).status, 'complete');
  }
  assert.equal(h.tokens.length, 4);
  assert.equal(h.records.size, 4);
  assert.equal(h.calls.filter(({ method }) => method === 'conversations.info').length, 4);
});

test('fresh workers never resume legacy or scene-tagged claims, pending posts, or interrupted processes', async () => {
  for (const progress of [
    { status: 'running', receipts: [] },
    { status: 'needs-review', pending: 0, receipts: [] },
    { status: 'running', receipts: [{ channel: 'CEXAMPLECHANNEL', ts: '2.000', thread_ts: trigger().ts }] },
    { status: 'complete', receipts: [] },
  ]) {
    for (const metadata of [{}, { scene: 'seed' }, { scene: 'playbook' }]) {
      const h = harness();
      const state = { ...progress, ...metadata };
      h.records.set(keyFor(trigger()), structuredClone(state));
      for (const scene of ['seed', 'playbook']) {
        const value = trigger({ text: scenes[scene][0].text });
        await runDemoReplies(value, h.options);
        await runDemoReplies(value, h.options);
      }
      assert.equal(h.calls.length, 0);
      assert.equal(h.tokens.length, 0);
      assert.equal(h.records.size, 1);
      assert.deepEqual(h.records.get(keyFor(trigger())), state);
      assert.ok(h.writes.every(({ key, options }) => key === keyFor(trigger()) && options?.nx === true));
    }
  }
});

test('KV preclaim failure or unconfirmed write has no token or Slack side effects', async () => {
  for (const outcome of ['throw', undefined, false]) {
    const h = harness();
    h.options.store = { set: async () => {
      if (outcome === 'throw') throw new Error('raw KV credential');
      return outcome;
    } };
    await assert.rejects(runDemoReplies(trigger(), h.options), genericFailure);
    assert.equal(h.tokens.length, 0);
    assert.equal(h.calls.length, 0);
  }
});

test('lost claim acknowledgement leaves its durable claim intact and cannot replay', async () => {
  const h = harness();
  const original = h.options.store.set;
  h.options.store.set = async (...args) => { await original(...args); throw new Error('lost ACK'); };
  await assert.rejects(runDemoReplies(trigger(), h.options), genericFailure);
  h.options.store.set = original;
  await runDemoReplies(trigger(), h.options);
  assert.equal(h.records.size, 1);
  assert.equal(h.tokens.length, 0);
  assert.equal(h.calls.length, 0);
});

test('pending and receipt storage failures prevent further posts and future replay', async () => {
  for (const failAt of [2, 3, 7, 9]) {
    const h = harness();
    const original = h.options.store.set;
    let writes = 0;
    h.options.store.set = async (...args) => {
      if (++writes >= failAt) throw new Error('KV unavailable');
      return original(...args);
    };
    await assert.rejects(runDemoReplies(trigger(), h.options), genericFailure);
    const expectedPosts = Math.floor((failAt - 1) / 2);
    assert.equal(h.calls.length, 1 + expectedPosts);
    if (failAt > 2) assert.equal(h.records.get(keyFor(trigger())).pending, expectedPosts - 1);
    h.options.store.set = original;
    await runDemoReplies(trigger(), h.options);
    assert.equal(h.calls.length, 1 + expectedPosts);
  }
});

test('ambiguous post failure preserves pending and is never automatically replayed', async () => {
  const h = harness();
  const original = h.options.call;
  h.options.call = async (...args) => {
    const result = await original(...args);
    if (args[1] === 'chat.postMessage') throw new Error('raw Slack secret');
    return result;
  };
  await assert.rejects(runDemoReplies(trigger(), h.options), genericFailure);
  assert.deepEqual(h.records.get(keyFor(trigger())), { status: 'needs-review', pending: 0, receipts: [] });
  await runDemoReplies(trigger(), h.options);
  assert.equal(h.calls.length, 2);
});

test('channel info must confirm matching id, explicitly public and not archived', async () => {
  for (const channel of [undefined, null, {}, { id: 'COTHER', is_private: false, is_archived: false },
    { id: 'CEXAMPLECHANNEL', is_private: true, is_archived: false },
    { id: 'CEXAMPLECHANNEL', is_archived: false }, { id: 'CEXAMPLECHANNEL', is_private: false },
    { id: 'CEXAMPLECHANNEL', is_private: false, is_archived: true }]) {
    const h = harness();
    h.options.call = async (_token, method, body) => {
      h.calls.push({ method, body });
      return { data: { channel } };
    };
    await assert.rejects(runDemoReplies(trigger(), h.options), genericFailure);
    await runDemoReplies(trigger(), h.options);
    assert.deepEqual(h.calls, [{ method: 'conversations.info', body: { channel: 'CEXAMPLECHANNEL' } }]);
    assert.equal(h.records.get(keyFor(trigger())).status, 'needs-review');
  }
});

test('wrong channel, missing thread confirmation, or malformed receipt stops all remaining replies', async () => {
  for (const data of [null, {}, { channel: 'COTHER', ts: '2.000', message: { thread_ts: trigger().ts } },
    { channel: 'CEXAMPLECHANNEL', ts: '2.000' },
    { channel: 'CEXAMPLECHANNEL', ts: '2.000', message: { thread_ts: '1.000' } },
    { channel: 'CEXAMPLECHANNEL', ts: 'bad', message: { thread_ts: trigger().ts } }]) {
    const h = harness();
    const original = h.options.call;
    h.options.call = async (...args) => args[1] === 'conversations.info' ? original(...args) : { data };
    await assert.rejects(runDemoReplies(trigger(), h.options), genericFailure);
    assert.equal(h.records.get(keyFor(trigger())).pending, 0);
    assert.equal(h.records.get(keyFor(trigger())).receipts.length, 0);
    await runDemoReplies(trigger(), h.options);
    assert.equal(h.tokens.length, 1);
  }
});

test('default Redis and Connect use persistent fromEnv options and the scoped installation', async () => {
  const h = harness();
  fromEnv.mock.mockImplementation(() => h.options.store);
  getToken.mock.mockImplementation(h.options.getToken);
  await runDemoReplies(trigger(), { call: h.options.call, wait: h.options.wait });
  assert.equal(fromEnv.mock.callCount(), 1);
  const [config] = fromEnv.mock.calls[0].arguments;
  assert.equal(config.retry, false);
  assert.equal(config.enableTelemetry, false);
  assert.ok(config.signal() instanceof AbortSignal);
  assert.equal(config.signal().aborted, false);
  assert.equal(getToken.mock.callCount(), 1);
  assert.deepEqual(h.writes[0].options, { nx: true });
  assert.ok(h.writes.slice(1).every((write) => write.options === undefined), 'no TTL or expiring claim');
});

test('shared Slack call retries only explicit 429 while pending stays durable', async () => {
  const h = harness();
  delete h.options.call;
  let posts = 0;
  h.options.fetchFn = async (url, init) => {
    assert.ok(init.signal instanceof AbortSignal);
    assert.equal(init.headers.Authorization, 'Bearer fake-token');
    if (url.includes('conversations.info')) {
      assert.equal(url, 'https://slack.com/api/conversations.info?channel=CEXAMPLECHANNEL');
      assert.equal(init.method, 'GET');
      return Response.json({ ok: true, channel: { id: 'CEXAMPLECHANNEL', is_private: false, is_archived: false } });
    }
    assert.equal(url, 'https://slack.com/api/chat.postMessage');
    const body = JSON.parse(init.body);
    assert.equal(h.records.get(keyFor(trigger())).pending, Math.max(0, posts - 1));
    posts++;
    if (posts === 1) return new Response('{}', { status: 429, headers: { 'retry-after': '2' } });
    return Response.json({ ok: true, channel: body.channel, ts: `${posts}.000`, message: { thread_ts: body.thread_ts } });
  };
  await runDemoReplies(trigger(), h.options);
  await runDemoReplies(trigger(), h.options);
  assert.equal(posts, 5, 'one explicit rejection plus exactly four accepted replies');
  assert.deepEqual(h.delays, [2000, 3000, 3000, 3000]);
  assert.equal(h.records.get(keyFor(trigger())).status, 'complete');
});

test('45s global deadline and shared 15s call timeout both cancel fetch without replay', async (t) => {
  for (const timeout of [45_000, 15_000]) {
    const h = harness();
    delete h.options.call;
    const clocks = new Map();
    const durations = [];
    const clock = t.mock.method(AbortSignal, 'timeout', (ms) => {
      durations.push(ms);
      const controller = new AbortController();
      clocks.set(ms, controller);
      return controller.signal;
    });
    let posts = 0;
    h.options.fetchFn = async (url, init) => {
      if (url.includes('conversations.info')) return Response.json({ ok: true,
        channel: { id: 'CEXAMPLECHANNEL', is_private: false, is_archived: false } });
      posts++;
      clocks.get(timeout).abort();
      assert.equal(init.signal.aborted, true);
      throw new Error('raw timeout details');
    };
    await assert.rejects(runDemoReplies(trigger(), h.options), genericFailure);
    assert.ok(durations.includes(45_000));
    assert.ok(durations.includes(15_000));
    assert.equal(h.records.get(keyFor(trigger())).pending, 0);
    await runDemoReplies(trigger(), h.options);
    assert.equal(posts, 1);
    clock.mock.restore();
  }
});

test('deadline cancels inter-message and rate-limit waits, with no later post or replay', async () => {
  for (const rateLimited of [false, true]) {
    const h = harness();
    const controller = new AbortController();
    h.options.signal = controller.signal;
    let observed;
    h.options.wait = async (ms, signal) => {
      observed = { ms, signal };
      controller.abort();
      return new Promise(() => {});
    };
    let posts = 0;
    delete h.options.call;
    h.options.fetchFn = async (url, init) => {
      if (url.includes('conversations.info')) return Response.json({ ok: true,
        channel: { id: 'CEXAMPLECHANNEL', is_private: false, is_archived: false } });
      posts++;
      if (rateLimited) return new Response('{}', { status: 429, headers: { 'retry-after': '120' } });
      const body = JSON.parse(init.body);
      return Response.json({ ok: true, channel: body.channel, ts: '2.000', message: { thread_ts: body.thread_ts } });
    };
    await assert.rejects(runDemoReplies(trigger(), h.options), genericFailure);
    assert.equal(observed.ms, rateLimited ? 120_000 : 3000);
    assert.equal(observed.signal.aborted, true);
    await runDemoReplies(trigger(), { ...h.options, signal: undefined });
    assert.equal(posts, 1);
    const state = h.records.get(keyFor(trigger()));
    assert.equal(state.receipts.length, rateLimited ? 0 : 1);
    assert.equal(state.pending, rateLimited ? 0 : undefined);
  }
});

test('cancellation during Connect bounds the worker and late token resolution cannot post', async () => {
  const h = harness();
  const controller = new AbortController();
  let release;
  h.options.signal = controller.signal;
  h.options.getToken = () => {
    controller.abort();
    return new Promise((resolve) => { release = resolve; });
  };
  await assert.rejects(runDemoReplies(trigger(), h.options), genericFailure);
  release('fake-token');
  await runDemoReplies(trigger(), { ...h.options, signal: undefined });
  assert.equal(h.calls.length, 0);
  assert.equal(h.records.size, 1);
});
