import { z } from 'zod';
import { cast, scenes } from '../scripts/demo-scenes.mjs';

const memberSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,64}$/),
  name: z.string().trim().min(1).max(50).regex(/^[^<>\r\n]+$/),
  emoji: z.string().regex(/^:[a-z0-9_+-]{2,40}:$/i),
});

const replySchema = z.object({
  memberId: memberSchema.shape.id,
  text: z.string().trim().min(1).max(500),
});

export const conversationSchema = z.object({
  id: z.string().regex(/^(?:seed|playbook|[0-9a-f-]{36})$/),
  title: z.string().trim().min(1).max(80),
  trigger: z.string().trim().min(1).max(500),
  enabled: z.boolean(),
  members: z.array(memberSchema).min(1).max(10),
  replies: z.array(replySchema).min(1).max(8),
}).superRefine((conversation, context) => {
  const ids = new Set(conversation.members.map((member) => member.id));
  if (ids.size !== conversation.members.length) {
    context.addIssue({ code: 'custom', message: 'Team member IDs must be unique.', path: ['members'] });
  }
  for (const [index, reply] of conversation.replies.entries()) {
    if (!ids.has(reply.memberId)) {
      context.addIssue({ code: 'custom', message: 'Choose a team member for every reply.', path: ['replies', index, 'memberId'] });
    }
  }
});

export type Conversation = z.infer<typeof conversationSchema>;

export const normalizeTrigger = (text: string): string =>
  text.replace(/[‘’]/g, "'").trim().replace(/\s+/g, ' ');

const defaultMembers = Object.entries(cast).map(([id, member]) => ({
  id, name: member.name, emoji: member.icon,
}));

function fromScene(id: 'seed' | 'playbook', title: string): Conversation {
  return conversationSchema.parse({
    id, title, trigger: scenes[id][0].text, enabled: true,
    members: defaultMembers,
    replies: scenes[id].slice(1).map((line) => ({ memberId: line.actor, text: line.text })),
  });
}

export const defaultConversations: Conversation[] = [
  fromScene('seed', 'Services conversation'),
  fromScene('playbook', 'Inbound lead playbook'),
];

export const isBuiltinConversation = (id: string): boolean => id === 'seed' || id === 'playbook';
