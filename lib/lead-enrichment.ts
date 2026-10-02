import { Client } from 'eve/client';
import { getVercelOidcToken } from '@vercel/oidc';
import { z } from 'zod';
import { contactSubmissionSchema, type ContactSubmission } from './contact';
import { researchResultSchema, type ResearchResult } from './lead-research';

export const leadContextSchema = contactSubmissionSchema.omit({ email: true });
export type LeadContext = z.infer<typeof leadContextSchema>;
const envelopeSchema = z.object({
  kind: z.literal('framing-display-lead.v1'),
  lead: leadContextSchema,
  businessDomain: z.string().nullable(),
  createdAt: z.number().int().nonnegative(),
});
export type LeadEnrichment =
  | { status: 'complete'; sessionId: string; createdAt: number; research: ResearchResult }
  | { status: 'unavailable'; createdAt: number };

const PERSONAL_DOMAINS = new Set(['gmail.com', 'googlemail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'live.com', 'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com']);
export function businessEmailDomain(email: string): string | null {
  const domain = email.split('@').at(-1)?.toLowerCase();
  return domain && !PERSONAL_DOMAINS.has(domain) ? domain : null;
}

export function createResearchClient(): Client {
  // Never derive a credential-bearing destination from inbound Host/Origin headers.
  const configured = process.env.EVE_AGENT_ORIGIN
    ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : `http://127.0.0.1:${process.env.PORT ?? '3000'}`);
  const origin = new URL(configured);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname);
  if (origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash
    || (origin.protocol !== 'https:' && !(local && origin.protocol === 'http:'))) {
    throw new Error('EVE_AGENT_ORIGIN must be an HTTPS origin or a local development origin.');
  }
  return new Client({
    host: origin.origin,
    redirect: 'error',
    ...(!local || process.env.VERCEL || process.env.NODE_ENV === 'production'
      ? { auth: { vercelOidc: { token: getVercelOidcToken } } } : {}),
  });
}

async function beforeDeadline<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  let rejectAbort: () => void = () => {};
  const abort = new Promise<never>((_, reject) => {
    rejectAbort = () => reject(signal.reason ?? new Error('Research deadline reached'));
    if (signal.aborted) rejectAbort();
    else signal.addEventListener('abort', rejectAbort, { once: true });
  });
  try { return await Promise.race([work, abort]); }
  finally { signal.removeEventListener('abort', rejectAbort); }
}

export async function enrichLead(
  input: ContactSubmission,
  options: { client?: Client; timeoutMs?: number } = {},
): Promise<LeadEnrichment> {
  const createdAt = Math.floor(Date.now() / 1000);
  const signal = AbortSignal.timeout(options.timeoutMs ?? 30_000);
  let session: ReturnType<Client['sessions']['attach']> | undefined;
  let cancellation: Promise<unknown> | undefined;
  const cancelSession = () => {
    if (!session) return Promise.resolve();
    cancellation ??= session.cancel({ tasks: true, signal: AbortSignal.timeout(2_000) }).catch(() => {});
    return cancellation;
  };
  let finished = false;
  try {
    const client = options.client ?? createResearchClient();
    const envelope = envelopeSchema.parse({
      kind: 'framing-display-lead.v1',
      // Keep only the display context needed for replay, never the full email.
      lead: leadContextSchema.parse(input),
      businessDomain: businessEmailDomain(input.email),
      createdAt,
    });
    const work = (async () => {
      const created = await client.sessions.create<ResearchResult>({
        message: JSON.stringify(envelope),
        outputSchema: z.toJSONSchema(researchResultSchema),
        signal,
        streamReconnectPolicy: { reconnect: false },
      });
      session = created.session;
      if (signal.aborted) throw new Error('Research deadline reached');
      const result = await created.response.result();
      if (result.status === 'failed') throw new Error('Research failed');
      const research = researchResultSchema.parse(result.data);
      return { status: 'complete' as const, sessionId: session.state.sessionId, createdAt, research };
    })();
    // If creation finishes after the deadline, still cancel that late session.
    void work.catch(async () => {
      if (signal.aborted) await cancelSession();
    });
    const enriched = await beforeDeadline(work, signal);
    finished = true;
    return enriched;
  } catch {
    return { status: 'unavailable', createdAt };
  } finally {
    // Aborting an HTTP stream does not stop the remote agent by itself.
    if (!finished) await cancelSession();
  }
}
