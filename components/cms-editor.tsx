'use client';

import { useEffect, useState, type FormEvent } from 'react';
import type { Conversation } from '../lib/conversations';

const emojiOptions = [
  [':briefcase:', '💼'], [':mega:', '📣'], [':art:', '🎨'],
  [':technologist:', '🧑‍💻'], [':bulb:', '💡'], [':sparkles:', '✨'],
  [':hammer_and_wrench:', '🛠️'], [':robot_face:', '🤖'],
  [':speech_balloon:', '💬'], [':camera:', '📷'],
] as const;

const emojiGlyph = (code: string): string =>
  emojiOptions.find(([name]) => name === code)?.[1] ?? '💬';

const starterMembers: Conversation['members'] = [
  { id: 'maya', name: 'Maya — Sales', emoji: ':briefcase:' },
  { id: 'jordan', name: 'Jordan — Marketing', emoji: ':mega:' },
  { id: 'alex', name: 'Alex — Design', emoji: ':art:' },
  { id: 'sam', name: 'Sam — Engineering', emoji: ':technologist:' },
];

const field = 'w-full rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-sm text-stone-900 outline-none transition focus:border-teal-700 focus:ring-2 focus:ring-teal-100';
const smallButton = 'rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-40';

function newDraft(source?: Conversation): Conversation {
  const members = structuredClone(source?.members ?? starterMembers);
  return { id: '', title: '', trigger: '', enabled: true, members,
    replies: [{ memberId: members[0].id, text: '' }] };
}

function sortConversations(items: Conversation[]): Conversation[] {
  return [...items].sort((a, b) => {
    const rank = (id: string) => id === 'seed' ? 0 : id === 'playbook' ? 1 : 2;
    return rank(a.id) - rank(b.id) || a.title.localeCompare(b.title);
  });
}

export function CmsEditor({ channel }: { channel: string }) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Conversation | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    fetch('/cms/api', { cache: 'no-store', credentials: 'same-origin' })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? 'Could not load conversations.');
        return data.conversations as Conversation[];
      })
      .then((items) => {
        if (!active) return;
        const sorted = sortConversations(items);
        setConversations(sorted);
        setSelectedId(sorted[0]?.id ?? null);
        setDraft(sorted[0] ? structuredClone(sorted[0]) : null);
      })
      .catch((cause) => { if (active) setError(cause.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  function change(next: Conversation) {
    setDraft(next);
    setNotice('');
    setError('');
  }

  function hasUnsavedChanges(): boolean {
    if (!draft) return false;
    if (selectedId === 'new') return true;
    return JSON.stringify(draft) !== JSON.stringify(conversations.find((item) => item.id === selectedId));
  }

  function canSwitch(): boolean {
    return !hasUnsavedChanges() || window.confirm('Discard unsaved changes?');
  }

  function select(item: Conversation) {
    if (!canSwitch()) return;
    setSelectedId(item.id);
    setDraft(structuredClone(item));
    setNotice(''); setError('');
  }

  function create() {
    if (!canSwitch()) return;
    setDraft(newDraft(draft ?? undefined));
    setSelectedId('new');
    setNotice(''); setError('');
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || busy) return;
    setBusy(true); setNotice(''); setError('');
    try {
      const response = await fetch('/cms/api', {
        method: selectedId === 'new' ? 'POST' : 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Could not save conversation.');
      const saved = data.conversation as Conversation;
      setConversations((items) => sortConversations([...items.filter((item) => item.id !== saved.id), saved]));
      setSelectedId(saved.id);
      setDraft(structuredClone(saved));
      setNotice(saved.enabled ? 'Saved. This trigger is live in Slack.' : 'Saved as a disabled conversation.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save conversation.');
    } finally { setBusy(false); }
  }

  async function remove() {
    if (!draft || selectedId === 'new' || selectedId === 'seed' || selectedId === 'playbook' || busy) return;
    if (!window.confirm(`Delete “${draft.title}”? This will stop future triggers.`)) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch('/cms/api', {
        method: 'DELETE', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: draft.id }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Could not delete conversation.');
      const rest = conversations.filter((item) => item.id !== draft.id);
      setConversations(rest);
      setSelectedId(rest[0]?.id ?? null);
      setDraft(rest[0] ? structuredClone(rest[0]) : null);
      setNotice('Conversation deleted.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not delete conversation.');
    } finally { setBusy(false); }
  }

  async function copyTrigger() {
    if (!draft?.trigger.trim()) return;
    try {
      await navigator.clipboard.writeText(draft.trigger.trim());
      setNotice('Trigger copied. Post it in the configured Slack channel.');
      setError('');
    } catch { setError('Could not copy the trigger. Select the text and copy it instead.'); }
  }

  function updateMember(id: string, patch: Partial<Conversation['members'][number]>) {
    if (!draft) return;
    change({ ...draft, members: draft.members.map((member) => member.id === id ? { ...member, ...patch } : member) });
  }

  function addMember() {
    if (!draft || draft.members.length >= 10) return;
    change({ ...draft, members: [...draft.members, {
      id: crypto.randomUUID(), name: '', emoji: ':speech_balloon:',
    }] });
  }

  function removeMember(id: string) {
    if (!draft || draft.members.length <= 1) return;
    if (draft.replies.some((reply) => reply.memberId === id)) {
      setError('Remove this member’s replies before removing the member.');
      return;
    }
    change({ ...draft, members: draft.members.filter((member) => member.id !== id) });
  }

  function updateReply(index: number, patch: Partial<Conversation['replies'][number]>) {
    if (!draft) return;
    change({ ...draft, replies: draft.replies.map((reply, position) => position === index ? { ...reply, ...patch } : reply) });
  }

  function moveReply(index: number, direction: -1 | 1) {
    if (!draft || index + direction < 0 || index + direction >= draft.replies.length) return;
    const replies = [...draft.replies];
    [replies[index], replies[index + direction]] = [replies[index + direction], replies[index]];
    change({ ...draft, replies });
  }

  return (
    <main className="min-h-screen bg-[#f4f3ef] pb-16 text-stone-900">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-4 sm:px-8">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-teal-900 text-lg text-white">💬</div>
            <div><p className="text-sm font-semibold leading-5">Conversation editor</p><p className="text-xs text-stone-500">nyc-framing · Slack demos</p></div>
          </div>
          <a className="text-sm font-medium text-teal-800 underline-offset-4 hover:underline" href="/">View website ↗</a>
        </div>
      </header>
      <div className="mx-auto max-w-7xl px-5 pt-10 sm:px-8">
        <div className="mb-8 max-w-3xl">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-teal-800">Demo studio</p>
          <h1 className="font-editorial text-4xl leading-tight sm:text-5xl">Make a conversation happen.</h1>
          <p className="mt-3 text-sm leading-6 text-stone-600 sm:text-base">Pick the exact Slack message that starts it, choose who replies, and save. Anyone in the configured channel can then post the trigger to start a new thread.</p>
        </div>
        <div className="grid gap-6 lg:grid-cols-[17rem_minmax(0,1fr)]">
          <aside className="h-fit rounded-2xl border border-stone-200 bg-white p-3 shadow-sm">
            <div className="flex items-center justify-between px-2 pb-3 pt-1">
              <h2 className="text-sm font-semibold">Conversations</h2>
              <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-600">{conversations.length}</span>
            </div>
            {loading && <p className="px-2 py-5 text-sm text-stone-500">Loading…</p>}
            {!loading && conversations.map((item) => (
              <button type="button" key={item.id} onClick={() => select(item)}
                className={`mb-1 w-full rounded-xl px-3 py-3 text-left transition ${selectedId === item.id ? 'bg-teal-950 text-white' : 'hover:bg-stone-100'}`}>
                <span className="block truncate text-sm font-medium">{item.title}</span>
                <span className={`mt-1 block text-xs ${selectedId === item.id ? 'text-teal-100' : 'text-stone-500'}`}>
                  {item.enabled ? '● Live' : '○ Disabled'} · {item.replies.length} {item.replies.length === 1 ? 'reply' : 'replies'}
                </span>
              </button>
            ))}
            <button type="button" onClick={create} disabled={loading}
              className="mt-2 w-full rounded-xl border border-dashed border-stone-300 px-3 py-3 text-left text-sm font-medium text-teal-800 hover:border-teal-700 hover:bg-teal-50 disabled:opacity-40">＋ New conversation</button>
          </aside>

          <div className="min-w-0 space-y-5">
            {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}
            {notice && <div role="status" className="rounded-xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-900">{notice}</div>}
            {draft && <form onSubmit={save} className="space-y-5">
              <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm sm:p-7">
                <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
                  <div><p className="text-xs font-semibold uppercase tracking-widest text-teal-800">01 / Setup</p><h2 className="mt-1 text-xl font-semibold">Trigger</h2></div>
                  <label className="flex cursor-pointer items-center gap-2 text-sm font-medium"><input type="checkbox" checked={draft.enabled} onChange={(event) => change({ ...draft, enabled: event.target.checked })} className="size-4 accent-teal-800" />Enabled</label>
                </div>
                <div className="grid gap-5">
                  <label className="block text-sm font-medium">Conversation name
                    <input className={`${field} mt-2`} maxLength={80} value={draft.title} placeholder="A new customer question" onChange={(event) => change({ ...draft, title: event.target.value })} />
                  </label>
                  <label className="block text-sm font-medium">Exact Slack message
                    <textarea className={`${field} mt-2 min-h-28 resize-y`} maxLength={500} value={draft.trigger} placeholder="What should someone post in Slack to start this conversation?" onChange={(event) => change({ ...draft, trigger: event.target.value })} />
                  </label>
                  <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-stone-500"><span>Listening in channel {channel}. Only a new message from a person starts a thread.</span><button type="button" onClick={copyTrigger} disabled={!draft.trigger.trim()} className={smallButton}>Copy trigger</button></div>
                </div>
              </section>

              <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm sm:p-7">
                <div className="mb-5 flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-widest text-teal-800">02 / Cast</p><h2 className="mt-1 text-xl font-semibold">Team members</h2><p className="mt-1 text-sm text-stone-500">These names and emoji appear on the Slack replies.</p></div><button type="button" onClick={addMember} disabled={draft.members.length >= 10} className={smallButton}>＋ Add member</button></div>
                <datalist id="cms-emoji-options">{emojiOptions.map(([code]) => <option key={code} value={code} />)}</datalist>
                <div className="space-y-3">{draft.members.map((member) => (
                  <div key={member.id} className="grid items-center gap-3 rounded-xl border border-stone-200 bg-stone-50 p-3 sm:grid-cols-[2.5rem_minmax(0,1fr)_10rem_auto]">
                    <span aria-hidden className="flex size-10 items-center justify-center rounded-lg bg-white text-xl shadow-sm">{emojiGlyph(member.emoji)}</span>
                    <label className="text-xs font-medium text-stone-600">Display name<input className={`${field} mt-1`} maxLength={50} value={member.name} placeholder="Name — Team" onChange={(event) => updateMember(member.id, { name: event.target.value })} /></label>
                    <label className="text-xs font-medium text-stone-600">Profile emoji<input className={`${field} mt-1`} list="cms-emoji-options" maxLength={42} value={member.emoji} placeholder=":sparkles:" onChange={(event) => updateMember(member.id, { emoji: event.target.value })} /></label>
                    <button type="button" onClick={() => removeMember(member.id)} disabled={draft.members.length <= 1} className={`${smallButton} self-end`}>Remove</button>
                  </div>
                ))}</div>
                <p className="mt-3 text-xs text-stone-500">Use Slack emoji shortcodes such as :briefcase: or :sparkles:. Custom workspace emoji work too.</p>
              </section>

              <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm sm:p-7">
                <div className="mb-5 flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-widest text-teal-800">03 / Script</p><h2 className="mt-1 text-xl font-semibold">Replies</h2><p className="mt-1 text-sm text-stone-500">They post in this order, three seconds apart, under the trigger message.</p></div><button type="button" disabled={draft.replies.length >= 8} onClick={() => change({ ...draft, replies: [...draft.replies, { memberId: draft.members[0].id, text: '' }] })} className={smallButton}>＋ Add reply</button></div>
                <div className="space-y-3">{draft.replies.map((line, index) => (
                  <div key={index} className="rounded-xl border border-stone-200 bg-stone-50 p-4">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><span className="text-xs font-semibold uppercase tracking-wider text-stone-500">Reply {index + 1}</span><div className="flex gap-1"><button type="button" aria-label={`Move reply ${index + 1} up`} onClick={() => moveReply(index, -1)} disabled={index === 0} className={smallButton}>↑</button><button type="button" aria-label={`Move reply ${index + 1} down`} onClick={() => moveReply(index, 1)} disabled={index === draft.replies.length - 1} className={smallButton}>↓</button><button type="button" onClick={() => change({ ...draft, replies: draft.replies.filter((_, position) => position !== index) })} disabled={draft.replies.length <= 1} className={smallButton}>Remove</button></div></div>
                    <label className="block text-xs font-medium text-stone-600">Team member<select className={`${field} mt-1`} value={line.memberId} onChange={(event) => updateReply(index, { memberId: event.target.value })}>{draft.members.map((member) => <option value={member.id} key={member.id}>{emojiGlyph(member.emoji)} {member.name || 'Unnamed member'}</option>)}</select></label>
                    <label className="mt-3 block text-xs font-medium text-stone-600">Message<textarea className={`${field} mt-1 min-h-24 resize-y`} maxLength={500} value={line.text} placeholder="What should they say?" onChange={(event) => updateReply(index, { text: event.target.value })} /></label>
                  </div>
                ))}</div>
              </section>

              <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm sm:p-7">
                <p className="text-xs font-semibold uppercase tracking-widest text-teal-800">Preview</p><h2 className="mt-1 text-xl font-semibold">How it will look</h2>
                <div className="mt-5 space-y-4 rounded-xl border border-stone-200 bg-stone-50 p-4 sm:p-5">
                  <div className="flex gap-3"><span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-stone-200">👤</span><div><p className="text-sm font-semibold">Someone in Slack <span className="font-normal text-stone-400">· trigger</span></p><p className="mt-1 whitespace-pre-wrap text-sm text-stone-700">{draft.trigger || 'Your trigger message appears here.'}</p></div></div>
                  {draft.replies.map((line, index) => { const member = draft.members.find((item) => item.id === line.memberId); return <div key={index} className="ml-4 flex gap-3 border-l-2 border-stone-200 pl-4"><span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white text-lg shadow-sm">{emojiGlyph(member?.emoji ?? '')}</span><div><p className="text-sm font-semibold">{member?.name || 'Team member'} <span className="font-normal text-stone-400">· reply {index + 1}</span></p><p className="mt-1 whitespace-pre-wrap text-sm text-stone-700">{line.text || 'Message appears here.'}</p></div></div>; })}
                </div>
              </section>

              <div className="flex flex-wrap items-center justify-between gap-3 pb-6">
                <div>{selectedId !== 'new' && selectedId !== 'seed' && selectedId !== 'playbook' && <button type="button" onClick={remove} disabled={busy} className="text-sm font-medium text-red-700 hover:underline disabled:opacity-40">Delete conversation</button>}</div>
                <button type="submit" disabled={busy} className="rounded-xl bg-teal-950 px-6 py-3 text-sm font-semibold text-white shadow-sm hover:bg-teal-800 disabled:opacity-50">{busy ? 'Saving…' : selectedId === 'new' ? 'Create conversation' : 'Save changes'}</button>
              </div>
            </form>}
          </div>
        </div>
      </div>
    </main>
  );
}
