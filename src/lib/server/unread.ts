import { ensure, upsert, scroll, f, eq, uuid_from, ZV, type QEnv } from './qdrant';
import type { Message } from '../types';
import { conv_id, group_conv_id } from './chat';
import { list_mutes } from './mute';

export type Read = { s: 'rd'; f: string; c: string; d: number };

export async function read_id(uid: string, conv: string): Promise<string> {
	return uuid_from(`read:${uid}:${conv}`);
}

async function read_marker(env: QEnv, uid: string, conv: string): Promise<number> {
	const pts = await scroll(env, f(eq('s', 'rd'), eq('f', uid), eq('c', conv)), 1);
	return pts.length ? (pts[0].payload as unknown as Read).d : 0;
}

export async function mark_read(env: QEnv, uid: string, conv: string, ts: number = Date.now()): Promise<void> {
	await ensure(env);
	const prev = await read_marker(env, uid, conv);
	const d = Math.max(prev, ts);
	const r: Read = { s: 'rd', f: uid, c: conv, d };
	await upsert(env, [{ id: await read_id(uid, conv), vector: ZV, payload: r as unknown as Record<string, unknown> }]);
}

export async function unread_by_conv(
	env: QEnv,
	uid: string,
	group_convs: string[] = []
): Promise<Record<string, number>> {
	await ensure(env);
	const [direct_msgs, group_lists, reads] = await Promise.all([
		scroll(env, f(eq('s', 'm'), eq('t', uid)), 1000),
		Promise.all(group_convs.map((c) => scroll(env, f(eq('s', 'm'), eq('c', c)), 1000))),
		scroll(env, f(eq('s', 'rd'), eq('f', uid)), 1000)
	]);
	const markers = new Map<string, number>();
	for (const p of reads) {
		const r = p.payload as unknown as Read;
		markers.set(r.c, r.d);
	}

	const counts: Record<string, number> = {};
	const tally = (msgs: Message[]) => {
		for (const m of msgs) {
			if (m.f === uid) continue;
			const marker = markers.get(m.c) ?? 0;
			if (m.d <= marker) continue;
			counts[m.c] = (counts[m.c] ?? 0) + 1;
		}
	};
	tally(direct_msgs.map((p) => p.payload as unknown as Message));
	for (const list of group_lists) tally(list.map((p) => p.payload as unknown as Message));

	return counts;
}

export async function total_unread(env: QEnv, uid: string, group_convs: string[] = []): Promise<number> {
	const by_conv = await unread_by_conv(env, uid, group_convs);
	const mutes = await list_mutes(env, uid);
	const silent = new Set(
		mutes.map((m) => (m.k === 'r' ? group_conv_id(m.tg) : conv_id(uid, m.tg)))
	);
	return Object.entries(by_conv)
		.filter(([conv]) => !silent.has(conv))
		.reduce((n, [, count]) => n + count, 0);
}
