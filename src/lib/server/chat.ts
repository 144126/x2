import type { Message, User, Match } from '../types';
import { ZV, ensure, new_id, upsert, retrieve_one, type QEnv, f, eq, scroll } from './qdrant';

export { ensure };

// deterministic 1:1 conversation id from two uids
export function conv_id(a: string, b: string): string {
	return [a, b].sort().join('|');
}

export async function send_msg(env: QEnv, from: string, to: string, text: string): Promise<Message> {
	await ensure(env);
	const m: Message = {
		s: 'm',
		id: new_id(),
		c: conv_id(from, to),
		f: from,
		t: to,
		x: text,
		d: Date.now()
	};
	await upsert(env, [{ id: m.id, vector: ZV, payload: m as unknown as Record<string, unknown> }]);
	return m;
}

export async function get_messages(env: QEnv, a: string, b: string): Promise<Message[]> {
	await ensure(env);
	const pts = await scroll(env, f(eq('s', 'm'), eq('c', conv_id(a, b))), 500);
	return pts
		.map((p) => p.payload as unknown as Message)
		.sort((x, y) => x.d - y.d);
}

// records that two users were paired by random match, so the thread shows up in both of
// their conversation lists even before either one sends a message (see list_conversations)
export async function record_match(env: QEnv, a: string, b: string): Promise<void> {
	await ensure(env);
	const match: Match = { s: 'x', f: a, t: b, d: Date.now() };
	await upsert(env, [
		{ id: `match:${conv_id(a, b)}`, vector: ZV, payload: match as unknown as Record<string, unknown> }
	]);
}

// list conversations for a user: latest peer + last message/match ts.
// Random matches show up immediately (with a placeholder preview) even before any message is
// sent; a real message always wins over the placeholder once one exists.
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

export async function get_user_name(env: QEnv, uid: string): Promise<string> {
	const u = (await retrieve_one(env, uid))?.payload as unknown as User | undefined;
	return u?.n ?? uid;
}
