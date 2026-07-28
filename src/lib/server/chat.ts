import type { User, Message, Match } from '../types';
import { ensure, upsert, retrieve_one, new_id, type QEnv, f, eq, scroll } from './qdrant';

export { ensure };

export function conv_id(a: string, b: string): string {
  return [a, b].sort().join('|');
}

export async function send_msg(
  env: QEnv,
  from: string,
  to: string,
  text: string,
  image?: string
): Promise<Message> {
  await ensure(env);
  const m: Message = {
    s: 'm',
    id: new_id(),
    c: conv_id(from, to),
    f: from,
    t: to,
    x: text,
    ...(image ? { im: image } : {}),
    d: Date.now()
  };
  await upsert(env, [{ id: m.id, vector: new Array(4096).fill(0), payload: m as unknown as Record<string, unknown> }]);
  return m;
}

// group messages reuse the message record and its `c` index: one conversation per group
export const group_conv_id = (gid: string): string => `g:${gid}`;

export async function send_group_msg(
  env: QEnv,
  from: string,
  group: string,
  text: string,
  image?: string
): Promise<Message> {
  await ensure(env);
  const m: Message = {
    s: 'm',
    id: new_id(),
    c: group_conv_id(group),
    f: from,
    t: '',
    gr: group,
    x: text,
    ...(image ? { im: image } : {}),
    d: Date.now()
  };
  await upsert(env, [{ id: m.id, vector: new Array(4096).fill(0), payload: m as unknown as Record<string, unknown> }]);
  return m;
}

export async function get_group_messages(env: QEnv, group: string): Promise<Message[]> {
  await ensure(env);
  const pts = await scroll(env, f(eq('s', 'm'), eq('c', group_conv_id(group))), 500);
  return pts.map((p) => p.payload as unknown as Message).sort((x, y) => x.d - y.d);
}

export async function get_messages(env: QEnv, a: string, b: string): Promise<Message[]> {
  await ensure(env);
  const pts = await scroll(env, f(eq('s', 'm'), eq('c', conv_id(a, b))), 500);
  return pts
    .map((p) => p.payload as unknown as Message)
    .sort((x, y) => x.d - y.d);
}

export async function list_conversations(env: QEnv, uid: string): Promise<{ peer: string; last: number; preview: string }[]> {
  await ensure(env);
  const [sent, recv, matched_a, matched_b] = await Promise.all([
    scroll(env, f(eq('s', 'm'), eq('f', uid)), 1000),
    scroll(env, f(eq('s', 'm'), eq('t', uid)), 1000),
    scroll(env, f(eq('s', 'x'), eq('f', uid)), 1000),
    scroll(env, f(eq('s', 'x'), eq('t', uid)), 1000)
  ]);
  const messages = [...sent, ...recv].map((p) => p.payload as unknown as Message);
  const matches = [...matched_a, ...matched_b].map((p) => p.payload as unknown as Match);

  const by_peer = new Map<string, { last: number; preview: string }>();
  for (const mt of matches) {
    const peer = mt.f === uid ? mt.t : mt.f;
    const cur = by_peer.get(peer);
    if (!cur || mt.d > cur.last) by_peer.set(peer, { last: mt.d, preview: 'you matched — say hi!' });
  }
  for (const m of messages) {
    const peer = m.f === uid ? m.t : m.f;
    const cur = by_peer.get(peer);
    if (!cur || m.d > cur.last) by_peer.set(peer, { last: m.d, preview: m.x });
  }
  return [...by_peer.entries()]
    .map(([peer, v]) => ({ peer, last: v.last, preview: v.preview }))
    .sort((a, b) => b.last - a.last);
}

export async function record_match(env: QEnv, a: string, b: string): Promise<void> {
  await ensure(env);
  const match: Match = { s: 'x', f: a, t: b, d: Date.now() };
  await upsert(env, [{ id: `match:${conv_id(a, b)}`, vector: new Array(4096).fill(0), payload: match as unknown as Record<string, unknown> }]);
}

export async function get_user_name(env: QEnv, uid: string): Promise<string> {
  const u = (await retrieve_one(env, uid))?.payload as unknown as User | undefined;
  return u?.u ?? uid;
}