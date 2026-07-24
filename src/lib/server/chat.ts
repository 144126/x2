import type { Message, User } from '$lib/types';
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

// list conversations for a user: latest peer + last message ts
export async function list_conversations(env: QEnv, uid: string): Promise<{ peer: string; last: number; preview: string }[]> {
	await ensure(env);
	const sent = await scroll(env, f(eq('s', 'm'), eq('f', uid)), 1000);
	const recv = await scroll(env, f(eq('s', 'm'), eq('t', uid)), 1000);
	const all = [...sent, ...recv].map((p) => p.payload as unknown as Message);
	const by_peer = new Map<string, Message>();
	for (const m of all) {
		const peer = m.f === uid ? m.t : m.f;
		const cur = by_peer.get(peer);
		if (!cur || m.d > cur.d) by_peer.set(peer, m);
	}
	return [...by_peer.values()]
		.map((m) => ({ peer: m.f === uid ? m.t : m.f, last: m.d, preview: m.x }))
		.sort((a, b) => b.last - a.last);
}

export async function get_user_name(env: QEnv, uid: string): Promise<string> {
	const u = (await retrieve_one(env, uid))?.payload as unknown as User | undefined;
	return u?.n ?? uid;
}
