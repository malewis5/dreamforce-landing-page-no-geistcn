import { randomUUID } from 'node:crypto';
import { Redis } from '@upstash/redis';
import type { ContactSubmission } from './contact';
import type { LeadEnrichment } from './lead-enrichment';

export type StoredLead = {
  id: string;
  createdAt: number;
  updatedAt: number;
  // Older saved leads predate the required budget field.
  submission: Omit<ContactSubmission, 'budget'> & { budget?: ContactSubmission['budget'] };
  enrichment?: LeadEnrichment;
  slack?: { channel: string; ts: string };
};

let redis: Redis | undefined;
function client() {
  // fromEnv accepts Vercel's KV_REST_API_URL/KV_REST_API_TOKEN as well as
  // UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN. Never expose these to clients.
  return redis ??= Redis.fromEnv({
    retry: false,
    signal: () => AbortSignal.timeout(5_000),
    enableTelemetry: false,
  });
}

const key = (id: string) => `dreamforce:lead:${id}`;

export async function createLead(submission: ContactSubmission): Promise<StoredLead> {
  const now = Math.floor(Date.now() / 1000);
  const lead: StoredLead = { id: `lead-${randomUUID()}`, createdAt: now, updatedAt: now, submission };
  await saveLead(lead);
  return lead;
}

export async function saveLead(lead: StoredLead): Promise<void> {
  // One JSON record per lead. No TTL, ORM, index, or separate Work Object store.
  await client().set(key(lead.id), lead);
}

export async function getLead(id: string): Promise<StoredLead | null> {
  if (!/^lead-[0-9a-f-]{36}$/.test(id)) return null;
  return client().get<StoredLead>(key(id));
}
