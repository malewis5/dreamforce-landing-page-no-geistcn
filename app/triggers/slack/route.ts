import { after } from 'next/server.js';
import { getToken } from '@vercel/connect';
import { createConnectWebhookVerifier } from '@vercel/connect/chat';
import { z } from 'zod';
import { buildContactSlackMessage } from '../../api/contact/slack-message';
import { getLead } from '../../../lib/lead-store';
import { matchDemoTrigger, runDemoReplies } from '../../../lib/demo-trigger';
import demoConfig from '../../../demo.config.json' with { type: 'json' };

export const runtime = 'nodejs';
export const maxDuration = 60;

const CONNECTOR = process.env.SLACK_CONNECTOR_ID || 'slack/demo-agent';
const APP_ID = process.env.SLACK_APP_ID || demoConfig.slackAppId;
const TEAM_ID = process.env.SLACK_TEAM_ID || demoConfig.slackTeamId;
// Verifies the forwarded bearer token against this deployment's project and
// environment. This route does not accept unsigned or direct Slack requests.
const verifyWebhook = createConnectWebhookVerifier();

const envelopeSchema = z.object({
  type: z.string(),
  api_app_id: z.string(),
  team_id: z.string(),
  event: z.object({ type: z.string() }).passthrough(),
});
const detailsSchema = z.object({
  type: z.literal('entity_details_requested'),
  trigger_id: z.string().min(1).max(500),
  entity_url: z.url(),
  external_ref: z.object({
    id: z.string().min(1).max(255),
    type: z.string().optional(),
  }),
});

export async function POST(request: Request): Promise<Response> {
  const body = await request.text();
  try {
    if (!await verifyWebhook(request, body)) throw new Error('Unverified webhook');
  } catch {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const challenge = z.object({ type: z.literal('url_verification'), challenge: z.string().min(1) }).safeParse(payload);
  if (challenge.success) return Response.json({ challenge: challenge.data.challenge });

  const envelope = envelopeSchema.safeParse(payload);
  if (!envelope.success) return Response.json({ error: 'Invalid event' }, { status: 400 });
  if (envelope.data.api_app_id !== APP_ID || envelope.data.team_id !== TEAM_ID) {
    return Response.json({ error: 'Wrong Slack app or workspace' }, { status: 403 });
  }
  if (envelope.data.type !== 'event_callback') return Response.json({ ok: true });
  if (envelope.data.event.type === 'message') {
    const trigger = matchDemoTrigger(envelope.data.event);
    if (trigger) {
      after(async () => {
        try {
          await runDemoReplies(trigger);
        } catch {
          // Never log message text, credentials, or raw storage errors.
          console.error('Demo thread replies failed; inspect saved delivery state before retrying.');
        }
      });
    }
    return Response.json({ ok: true });
  }
  if (envelope.data.event.type !== 'entity_details_requested') return Response.json({ ok: true });

  const details = detailsSchema.safeParse(envelope.data.event);
  if (!details.success) return Response.json({ error: 'Invalid details request' }, { status: 400 });
  const event = details.data;
  const expectedUrl = `https://example.com/demo/leads/${encodeURIComponent(event.external_ref.id)}`;
  const validIdentity = (event.external_ref.type === undefined || event.external_ref.type === 'lead')
    && event.entity_url === expectedUrl;
  const leadId = validIdentity && /^lead-[0-9a-f-]{36}$/.test(event.external_ref.id)
    ? event.external_ref.id : undefined;

  // Acknowledge immediately, then read the saved record from KV.
  // Opening or refreshing never starts another research turn.
  after(async () => {
    try {
      const token = await getToken(CONNECTOR, {
        subject: { type: 'app' }, installationId: TEAM_ID,
      });
      let detailBody: Record<string, unknown> = { error: { status: 'not_found' } };
      if (leadId) {
        try {
          const saved = await getLead(leadId);
          if (saved) {
            detailBody = { metadata: buildContactSlackMessage(saved.submission, saved, saved.enrichment).metadata.entities[0] };
          }
        } catch {
          detailBody = { error: {
            status: 'custom', custom_title: 'Lead temporarily unavailable',
            custom_message: 'The saved lead could not be loaded. Please refresh this panel to try again.',
          } };
        }
      }

      const response = await fetch('https://slack.com/api/entity.presentDetails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify({
          trigger_id: event.trigger_id,
          ...detailBody,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      const result = await response.json();
      if (!response.ok || result.ok !== true) {
        console.error('Slack entity.presentDetails failed:', result.error ?? response.status);
      }
    } catch {
      // Never log token-bearing request objects or the inbound payload.
      console.error('Slack Work Object details could not be delivered.');
    }
  });

  return Response.json({ ok: true });
}
