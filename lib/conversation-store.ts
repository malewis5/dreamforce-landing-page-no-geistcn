import { randomUUID } from 'node:crypto';
import { Redis } from '@upstash/redis';
import { conversationSchema, defaultConversations, isBuiltinConversation, normalizeTrigger } from './conversations';
import type { Conversation } from './conversations';

const indexKey = 'nyc-framing:cms:conversation-ids:v1';
const key = (id: string): string => `nyc-framing:cms:conversation:v1:${id}`;

export type ConversationStore = {
  smembers(key: string): Promise<string[]>;
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: Conversation): Promise<unknown>;
  sadd(key: string, member: string): Promise<unknown>;
  srem(key: string, member: string): Promise<unknown>;
  del(key: string): Promise<unknown>;
};

let redis: Redis | undefined;
const client = (): ConversationStore => redis ??= Redis.fromEnv({
  retry: false,
  signal: () => AbortSignal.timeout(5_000),
  enableTelemetry: false,
});

export class ConversationError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function listConversations(store: ConversationStore = client()): Promise<Conversation[]> {
  const ids = await store.smembers(indexKey);
  if (ids.length > 50 || ids.some((id) => !/^[0-9a-f-]{36}$/.test(id))) {
    throw new Error('Invalid conversation index.');
  }
  const records = await Promise.all([...defaultConversations.map((item) => item.id), ...ids]
    .map((id) => store.get<Conversation>(key(id))));
  const defaults = defaultConversations.map((item, index) => records[index]
    ? conversationSchema.parse(records[index]) : structuredClone(item));
  const custom = records.slice(defaults.length)
    .filter((record): record is Conversation => record !== null)
    .map((record) => conversationSchema.parse(record));
  return [...defaults, ...custom.sort((a, b) => a.title.localeCompare(b.title))];
}

export async function saveConversation(
  input: unknown,
  create: boolean,
  store: ConversationStore = client(),
): Promise<Conversation> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ConversationError('Invalid conversation.', 400);
  }
  const value = input as Record<string, unknown>;
  const parsed = conversationSchema.safeParse({ ...value, id: create ? randomUUID() : value.id });
  if (!parsed.success) {
    throw new ConversationError(parsed.error.issues[0]?.message ?? 'Invalid conversation.', 400);
  }
  const conversation = parsed.data;
  const existing = await listConversations(store);
  if (create && existing.length >= 50) throw new ConversationError('Conversation limit reached.', 409);
  if (!create && !existing.some((item) => item.id === conversation.id)) {
    throw new ConversationError('Conversation not found.', 404);
  }
  if (conversation.enabled && existing.some((item) => item.id !== conversation.id && item.enabled
    && normalizeTrigger(item.trigger) === normalizeTrigger(conversation.trigger))) {
    throw new ConversationError('Another enabled conversation already uses this trigger.', 409);
  }
  if (create) await store.sadd(indexKey, conversation.id);
  await store.set(key(conversation.id), conversation);
  return conversation;
}

export async function deleteConversation(id: string, store: ConversationStore = client()): Promise<void> {
  if (isBuiltinConversation(id)) throw new ConversationError('Built-in conversations can be disabled, not deleted.', 400);
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new ConversationError('Invalid conversation ID.', 400);
  await store.del(key(id));
  await store.srem(indexKey, id);
}
