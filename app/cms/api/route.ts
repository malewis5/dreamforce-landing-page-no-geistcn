import { deleteConversation, listConversations, saveConversation, ConversationError } from '../../../lib/conversation-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const reply = (body: unknown, status = 200): Response => Response.json(body, {
  status, headers: { 'Cache-Control': 'no-store' },
});

function failure(error: unknown): Response {
  if (error instanceof ConversationError) return reply({ error: error.message }, error.status);
  console.error('Conversation editor storage request failed.');
  return reply({ error: 'Conversation storage is unavailable. Please try again.' }, 503);
}

function sameOrigin(request: Request): boolean {
  return request.headers.get('origin') === new URL(request.url).origin;
}

async function readBody(request: Request): Promise<unknown> {
  if (!request.headers.get('content-type')?.startsWith('application/json')) {
    throw new ConversationError('Send JSON data.', 415);
  }
  const text = await request.text();
  if (text.length > 24_000) throw new ConversationError('Conversation is too large.', 413);
  try { return JSON.parse(text); } catch { throw new ConversationError('Invalid JSON.', 400); }
}

export async function GET(): Promise<Response> {
  try { return reply({ conversations: await listConversations() }); }
  catch (error) { return failure(error); }
}

export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return reply({ error: 'Invalid request origin.' }, 403);
  try { return reply({ conversation: await saveConversation(await readBody(request), true) }, 201); }
  catch (error) { return failure(error); }
}

export async function PUT(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return reply({ error: 'Invalid request origin.' }, 403);
  try { return reply({ conversation: await saveConversation(await readBody(request), false) }); }
  catch (error) { return failure(error); }
}

export async function DELETE(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return reply({ error: 'Invalid request origin.' }, 403);
  try {
    const body = await readBody(request);
    if (!body || typeof body !== 'object' || !('id' in body) || typeof body.id !== 'string') {
      throw new ConversationError('Invalid conversation ID.', 400);
    }
    await deleteConversation(body.id);
    return reply({ ok: true });
  } catch (error) { return failure(error); }
}
