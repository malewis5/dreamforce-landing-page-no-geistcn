import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { buildMessage, parseOptions, playScene, readState, slackCall, statePath, target } from '../scripts/demo.mjs';
import { scenes } from '../scripts/demo-scenes.mjs';
import demoConfig from '../demo.config.json' with { type: 'json' };

function harness(overrides = {}) {
  const snapshots = [];
  const posts = [];
  const delays = [];
  const state = { scenes: {} };
  return {
    state, snapshots, posts, delays,
    options: {
      state, scene: 'seed', log() {},
      save: async (value) => snapshots.push(structuredClone(value)),
      post: async (message) => { posts.push(message); return { ts: `${posts.length}.000`, channel: target.channel, message: { thread_ts: message.thread_ts } }; },
      wait: async (ms) => delays.push(ms), ...overrides,
    },
  };
}

async function stateDirectory(t) {
  const directory = await mkdtemp(join(tmpdir(), 'demo-state-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

function savedState(destination = target) {
  return {
    version: 1, run: 'rehearsal', team: destination.team, channel: destination.channel,
    scenes: { seed: { hash: 'saved-hash', messages: [{ ts: '123.000', channel: destination.channel }] } },
    pending: { scene: 'seed', index: 1 },
  };
}

test('changing channels starts independent progress and leaves old legacy receipts untouched', async (t) => {
  const directory = await stateDirectory(t);
  const previous = { ...target, channel: 'COLDCHANNEL' };
  const legacy = savedState(previous);
  const contents = JSON.stringify(legacy);
  await writeFile(join(directory, 'rehearsal.json'), contents);
  const state = await readState(directory, 'rehearsal');
  assert.deepEqual(state.scenes, {});
  assert.equal(state.channel, target.channel);
  assert.equal(state.pending, undefined);
  assert.equal(await readFile(join(directory, 'rehearsal.json'), 'utf8'), contents);
  // Returning to the previous channel still respects its receipts and pending marker.
  assert.deepEqual(await readState(directory, 'rehearsal', previous), legacy);
});

test('same-channel legacy receipts and uncertain delivery survive the storage layout change', async (t) => {
  const directory = await stateDirectory(t);
  const legacy = savedState();
  await writeFile(join(directory, 'rehearsal.json'), JSON.stringify(legacy));
  assert.deepEqual(await readState(directory, 'rehearsal'), legacy);
});

test('channel-scoped progress takes precedence and isolates workspace and channel', async (t) => {
  const directory = await stateDirectory(t);
  const scoped = savedState();
  delete scoped.pending;
  const path = statePath(directory, 'rehearsal');
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(scoped));
  await writeFile(join(directory, 'rehearsal.json'), JSON.stringify(savedState()));
  assert.deepEqual(await readState(directory, 'rehearsal'), scoped);
  for (const destination of [{ ...target, team: 'TOTHER' }, { ...target, channel: 'COTHER' }]) {
    assert.notEqual(statePath(directory, 'rehearsal', destination), path);
    assert.deepEqual((await readState(directory, 'rehearsal', destination)).scenes, {});
  }
});

test('corrupt or wrong-channel scoped state cannot fall back and accidentally replay', async (t) => {
  const directory = await stateDirectory(t);
  const path = statePath(directory, 'rehearsal');
  await mkdir(dirname(path), { recursive: true });
  for (const contents of ['{broken', JSON.stringify(savedState({ ...target, channel: 'CWRONG' }))]) {
    await writeFile(path, contents);
    await assert.rejects(readState(directory, 'rehearsal'), /invalid or unreadable/);
  }
});

test('malformed legacy state still fails closed', async (t) => {
  const directory = await stateDirectory(t);
  for (const contents of ['{broken', 'null', JSON.stringify({ channel: target.channel })]) {
    await writeFile(join(directory, 'rehearsal.json'), contents);
    await assert.rejects(readState(directory, 'rehearsal'), /invalid or unreadable/);
  }
});

test('runner destination, payload, and progress location use the shared channel setting', () => {
  assert.match(demoConfig.slackChannel, /^[CG][A-Z0-9]+$/);
  assert.equal(target.channel, demoConfig.slackChannel);
  assert.equal(buildMessage(scenes.seed[0]).channel, demoConfig.slackChannel);
  assert.equal(statePath('/tmp/demo-test', 'rehearsal'),
    join('/tmp/demo-test', target.team, demoConfig.slackChannel, 'rehearsal.json'));
});

test('CLI accepts scenes and rejects accidental replay/path/argument errors', () => {
  assert.equal(parseOptions(['seed']).scene, 'seed');
  assert.deepEqual(parseOptions(['next', 'playbook', '--run', 'take-2', '--delay', '2']), {
    command: 'next', scene: 'playbook', run: 'take-2', delay: 2, dryRun: false,
  });
  assert.equal(parseOptions(['play', 'website', '--dry-run']).dryRun, true);
  for (const args of [['play'], ['play', 'nope'], ['seed', '--run', '../oops'], ['seed', '--delay', '0'], ['seed', '--delay', 'NaN'], ['seed', 'extra'], ['seed', '--replay']]) {
    assert.throws(() => parseOptions(args));
  }
});

test('payload fixes destination, uses clean cast names and a standard avatar, and disables mentions/unfurls', () => {
  const message = buildMessage({ actor: 'maya', text: '<@U123> & <!channel>' });
  assert.equal(message.channel, target.channel);
  assert.equal(message.username, 'Maya — Sales');
  assert.equal(message.icon_emoji, ':briefcase:');
  assert.equal(message.thread_ts, undefined);
  assert.equal(message.text, '&lt;@U123&gt; &amp; &lt;!channel&gt;');
  assert.equal(message.mrkdwn, false);
  assert.equal(message.parse, 'none');
  assert.equal(message.unfurl_links, false);
});

test('Services replies stay brief and audience-readable', () => {
  assert.deepEqual(scenes.seed.map((line) => line.actor), ['maya', 'jordan', 'maya', 'alex', 'sam']);
  assert.equal(buildMessage(scenes.seed[1]).username, 'Jordan — Marketing');
  assert.equal(buildMessage(scenes.seed[1]).icon_emoji, ':mega:');
  assert.equal(scenes.seed[0].text, 'A prospect asked if we only frame individual pieces or handle a full display project. Our website introduces the studio, but there isn’t a clear Services section. Can we make the full offering easier to understand?');
  assert.match(scenes.seed[1].text, /between Studio and Commission/);
  assert.match(scenes.seed[2].text, /design, build, and install/);
  assert.match(scenes.seed[3].text, /display-case photo/);
  assert.match(scenes.seed[3].text, /existing design/);
  assert.equal(buildMessage(scenes.seed[3]).username, 'Alex — Design');
  assert.equal(buildMessage(scenes.seed[3]).icon_emoji, ':art:');
  assert.equal(buildMessage(scenes.seed[4]).username, 'Sam — Engineering');
  assert.equal(scenes.seed[4].text, 'This is the nyc-framing project in Vercel.');
  for (const { text } of scenes.seed.slice(1)) {
    assert.ok(text.length <= 160, 'Replies must fit in a short Slack message');
    assert.ok(text.split(/\s+/).length <= 30, 'No walls of text onstage');
    assert.equal(text.includes('\n'), false, 'No multi-paragraph specifications');
  }
  assert.ok(scenes.seed.every((line) => !/uncomment|restore|unhide|single desk|furniture/i.test(line.text)));
});

test('Inbound Lead Agent scene is a short Engineering, Sales, and Marketing conversation', () => {
  assert.equal(scenes.playbook[0].text, 'The website is clearer now. Can we make sure the inbound lead agent knows which projects we actually want?');
  assert.notEqual(scenes.playbook[0].text, scenes.seed[0].text);
  assert.deepEqual(scenes.playbook.map((line) => line.actor), ['maya', 'sam', 'maya', 'jordan']);
  assert.equal(scenes.playbook[1].text, 'The prototype is live in the nyc-framing project in Vercel. It researches companies and posts a fit score in Slack.');
  for (const message of [scenes.seed[4], scenes.playbook[1]]) {
    assert.equal(message.actor, 'sam');
    assert.ok(message.text.includes('the nyc-framing project in Vercel'), 'Both demos must identify the Vercel project explicitly');
  }
  assert.match(scenes.playbook[1].text, /fit score/);
  assert.match(scenes.playbook[2].text, /premium NYC spaces/);
  assert.match(scenes.playbook[2].text, /\$30–50k/);
  assert.match(scenes.playbook[2].text, /ask—don’t guess/);
  assert.match(scenes.playbook[3].text, /end-to-end studio/);
  assert.match(scenes.playbook[3].text, /draft/);
  assert.match(scenes.playbook[3].text, /design consultation/);
  for (const { text } of scenes.playbook) {
    assert.ok(text.length <= 160, 'Each onstage message stays short');
    assert.ok(text.split(/\s+/).length <= 30);
    assert.equal(text.includes('\n'), false);
  }
});

test('CLI plays the playbook independently without marking Services as played', async () => {
  const h = harness();
  assert.equal(await playScene({ ...h.options, scene: 'playbook' }), 4);
  assert.deepEqual(h.posts.map((post) => post.username), ['Maya — Sales', 'Sam — Engineering', 'Maya — Sales', 'Jordan — Marketing']);
  assert.equal(h.posts[0].thread_ts, undefined);
  assert.ok(h.posts.slice(1).every((post) => post.thread_ts === '1.000'));
  assert.equal(h.state.scenes.seed, undefined);
});

test('posts in order, persists pending before each send, paces messages, skips completed scenes', async () => {
  const h = harness();
  assert.equal(await playScene(h.options), scenes.seed.length);
  assert.equal(h.posts.length, scenes.seed.length);
  assert.deepEqual(h.snapshots[0].pending, { scene: 'seed', index: 0 });
  assert.equal(h.snapshots[1].pending, undefined);
  assert.equal(h.state.scenes.seed.messages.length, scenes.seed.length);
  assert.equal(h.posts[0].thread_ts, undefined);
  for (const reply of h.posts.slice(1)) {
    assert.equal(reply.thread_ts, '1.000');
    assert.equal(reply.reply_broadcast, false);
  }
  assert.equal(h.state.scenes.seed.messages[1].thread_ts, '1.000');
  assert.deepEqual(h.delays, Array(scenes.seed.length - 1).fill(3000));
  assert.equal(await playScene(h.options), 0);
  assert.equal(h.posts.length, scenes.seed.length);
});

test('next advances just one line and resumes from saved progress', async () => {
  const h = harness({ one: true });
  await playScene(h.options);
  // Simulate another CLI process loading the saved JSON before posting the reply.
  await playScene({ ...h.options, state: structuredClone(h.snapshots.at(-1)) });
  assert.equal(h.posts[0].thread_ts, undefined);
  assert.equal(h.posts[1].thread_ts, '1.000');
  assert.equal(h.posts.length, 2);
  assert.equal(h.posts[1].text, buildMessage(scenes.seed[1]).text);
  assert.deepEqual(h.delays, []);
});

test('each scene gets its own parent and all later lines reply without broadcasting', async () => {
  const h = harness();
  for (const scene of Object.keys(scenes)) {
    const start = h.posts.length;
    await playScene({ ...h.options, scene });
    const parentTs = h.state.scenes[scene].messages[0].ts;
    assert.equal(h.posts[start].thread_ts, undefined);
    for (const reply of h.posts.slice(start + 1)) {
      assert.equal(reply.thread_ts, parentTs);
      assert.equal(reply.reply_broadcast, false);
    }
  }
  assert.ok(h.posts.every((message) => !message.username.includes('(Demo)')));
});

test('missing thread confirmation preserves pending marker instead of silently accepting a top-level reply', async () => {
  const h = harness({ one: true });
  await playScene(h.options);
  await assert.rejects(playScene({ ...h.options,
    post: async () => ({ ts: '2.000', channel: target.channel }),
  }), /did not confirm the expected thread/);
  assert.deepEqual(h.state.pending, { scene: 'seed', index: 1 });
  assert.equal(h.state.scenes.seed.messages.length, 1);
});

test('uncertain delivery retains pending marker and prevents duplicate retry', async () => {
  const h = harness({ post: async () => { throw new Error('timeout'); } });
  await assert.rejects(playScene(h.options), /timeout/);
  assert.deepEqual(h.state.pending, { scene: 'seed', index: 0 });
  assert.equal(h.state.scenes.seed.messages.length, 0);
  await assert.rejects(playScene(h.options), /Uncertain delivery/);
});

test('unexpected receipt blocks continuation and changed dialogue requires a new run', async () => {
  const h = harness({ post: async () => ({ channel: 'wrong', ts: '1' }) });
  await assert.rejects(playScene(h.options), /unexpected message receipt/);
  assert.ok(h.state.pending);
  const other = harness({ one: true });
  await playScene(other.options);
  other.state.scenes.seed.hash = 'old-scene';
  await assert.rejects(playScene(other.options), /scene changed/);
});

test('Slack 429 respects retry-after then returns receipt and granted scopes', async () => {
  const delays = [];
  let calls = 0;
  const result = await slackCall('fake-token', 'chat.postMessage', { text: 'test' }, {
    wait: async (ms) => delays.push(ms),
    fetchFn: async (url, options) => {
      assert.equal(url, 'https://slack.com/api/chat.postMessage');
      assert.equal(options.redirect, 'error');
      calls++;
      return calls === 1
        ? new Response('{}', { status: 429, headers: { 'retry-after': '2' } })
        : Response.json({ ok: true, ts: '1' }, { headers: { 'x-oauth-scopes': 'chat:write,chat:write.customize' } });
    },
  });
  assert.equal(calls, 2);
  assert.deepEqual(delays, [2000]);
  assert.equal(result.data.ts, '1');
  assert.ok(result.scopes.includes('chat:write.customize'));
});

test('channel preflight uses GET query parameters rather than an unsupported JSON body', async () => {
  await slackCall('fake-token', 'conversations.info', { channel: target.channel }, {
    fetchFn: async (url, options) => {
      assert.equal(url, `https://slack.com/api/conversations.info?channel=${target.channel}`);
      assert.equal(options.method, 'GET');
      assert.equal(options.body, undefined);
      return Response.json({ ok: true, channel: { id: target.channel } });
    },
  });
});

test('HTTP 200 Slack errors and ambiguous transport failures fail safely without leaking secrets', async () => {
  await assert.rejects(slackCall('secret', 'chat.postMessage', {}, {
    fetchFn: async () => Response.json({ ok: false, error: 'missing_scope' }),
  }), /missing_scope/);
  let calls = 0;
  await assert.rejects(slackCall('secret', 'chat.postMessage', {}, {
    fetchFn: async () => { calls++; throw new Error('secret credential'); },
  }), (error) => error.message.includes('No automatic retry') && !error.message.includes('secret'));
  assert.equal(calls, 1);
});
