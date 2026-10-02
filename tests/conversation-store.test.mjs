import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultConversations } from '../lib/conversations.ts';
import { validCmsAuthorization } from '../lib/cms-auth.ts';
import { deleteConversation, listConversations, saveConversation } from '../lib/conversation-store.ts';

function store() {
  const records = new Map();
  const index = new Set();
  return {
    records, index,
    async smembers() { return [...index]; },
    async get(key) { return structuredClone(records.get(key) ?? null); },
    async set(key, value) { records.set(key, structuredClone(value)); return 'OK'; },
    async sadd(_key, id) { index.add(id); return 1; },
    async srem(_key, id) { index.delete(id); return 1; },
    async del(key) { records.delete(key); return 1; },
  };
}

function draft(trigger = 'Please show a new display concept.') {
  return { ...structuredClone(defaultConversations[0]), id: '', title: 'Display concept', trigger,
    replies: [{ memberId: 'alex', text: 'I will sketch one.' }] };
}

test('starts with the two existing conversations and stores edits in Redis', async () => {
  const db = store();
  assert.deepEqual(await listConversations(db), defaultConversations);
  const updated = { ...structuredClone(defaultConversations[0]), trigger: 'New Services kickoff', enabled: false };
  await saveConversation(updated, false, db);
  const listed = await listConversations(db);
  assert.deepEqual(listed[0], updated);
  assert.deepEqual(listed[1], defaultConversations[1]);
  assert.equal(db.index.size, 0, 'built-in edits use an override, not a custom ID');
});

test('creates, reloads, edits, and deletes a custom conversation', async () => {
  const db = store();
  const created = await saveConversation(draft(), true, db);
  assert.match(created.id, /^[0-9a-f-]{36}$/);
  assert.equal((await listConversations(db))[2].title, 'Display concept');
  await saveConversation({ ...created, title: 'Display concept v2', enabled: false }, false, db);
  assert.equal((await listConversations(db))[2].enabled, false);
  await deleteConversation(created.id, db);
  assert.deepEqual(await listConversations(db), defaultConversations);
});

test('rejects duplicate triggers, invalid reply members, and deleting built-ins', async () => {
  const db = store();
  await assert.rejects(saveConversation(draft(defaultConversations[0].trigger.replaceAll('’', "'")), true, db),
    /already uses this trigger/);
  await assert.rejects(saveConversation({ ...draft(), replies: [{ memberId: 'missing', text: 'Hello' }] }, true, db),
    /Choose a team member/);
  await assert.rejects(deleteConversation('seed', db), /can be disabled/);
  assert.equal(db.index.size, 0);
});

test('only the configured editor password authenticates', () => {
  const header = (user, password) => `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
  assert.equal(validCmsAuthorization(header('editor', 'correct horse'), 'correct horse'), true);
  for (const value of [null, 'Bearer token', header('other', 'correct horse'),
    header('editor', 'wrong'), header('editor', 'correct horse:extra')]) {
    assert.equal(validCmsAuthorization(value, 'correct horse'), false);
  }
});
