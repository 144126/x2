import type { Message, Match } from '../types';
import { ensure, upsert, retrieve_one, remove, new_id, type QEnv, f, f_or, eq, scroll, search, ZV, update_vectors } from './qdrant';
import { embed } from './or';
import { get_group } from './group';
export { get_user_name } from './user';

export { ensure };

export function conv_id(a: string, b: string): string {
	return [a, b].sort().join('|');
}

// The embedding call is ~900ms (measured 660-1195ms against api.voxell.ai), so messages are
// inserted with ZV and get their real vector patched in afterwards. Callers hand this to
// locals.bg so it runs after the response.
//
// updateVectors, not upsert: it writes the vector only. An upsert here would restore the
// payload snapshot taken before the embedding call and so undo an edit or delete that
// landed in the ~900ms window.
export async function backfill_vector(env: QEnv, id: string, text: string): Promise<void> {
	if (text.trim().length < 3) return;
	const vector = await embed(env, text);
	if (vector === ZV) return;
	await update_vectors(env, id, vector);
}

export async function send_msg(
	env: QEnv,
	from: string,
	to: string,
	text: string,
	image?: string,
	file?: Message['fl']
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
		...(file ? { fl: file } : {}),
		d: Date.now()
	};
	await upsert(env, [
		{
			id: m.id,
			vector: ZV,
			payload: m as unknown as Record<string, unknown>
		}
	]);
	return m;
}

// group messages reuse the message record and its `c` index: one conversation per group
export const group_conv_id = (gid: string): string => `g:${gid}`;

export async function send_group_msg(
	env: QEnv,
	from: string,
	group: string,
	text: string,
	image?: string,
	file?: Message['fl']
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
		...(file ? { fl: file } : {}),
		d: Date.now()
	};
	await upsert(env, [
		{
			id: m.id,
			vector: ZV,
			payload: m as unknown as Record<string, unknown>
		}
	]);
	return m;
}

export async function search_messages(
	env: QEnv,
	uid: string,
	q: string,
	conv?: string,
	limit = 20
): Promise<Message[]> {
	await ensure(env);
	const vector = await embed(env, q);
	const filter = conv
		? f(eq('s', 'm'), eq('c', conv))
		: f_or([eq('s', 'm')], [eq('f', uid), eq('t', uid)]);
	const pts = await search(env, vector, filter, limit);
	return pts.map((p) => p.payload as unknown as Message);
}

export const PAGE = 50;

async function page_msgs(env: QEnv, conv: string, before?: number): Promise<Message[]> {
	const pts = await scroll(env, f(eq('s', 'm'), eq('c', conv)), PAGE, undefined, {
		key: 'd',
		direction: 'desc',
		...(before === undefined ? {} : { start_from: before - 1 })
	});
	return pts.map((p) => p.payload as unknown as Message).sort((x, y) => x.d - y.d);
}

export async function get_messages(
	env: QEnv,
	a: string,
	b: string,
	before?: number
): Promise<Message[]> {
	await ensure(env);
	return page_msgs(env, conv_id(a, b), before);
}

export async function get_group_messages(
	env: QEnv,
	group: string,
	before?: number
): Promise<Message[]> {
	await ensure(env);
	return page_msgs(env, group_conv_id(group), before);
}

export async function edit_msg(
	env: QEnv,
	uid: string,
	msg_id: string,
	new_text: string
): Promise<Message> {
	await ensure(env);
	const pt = await retrieve_one(env, msg_id, true);
	if (!pt || pt.payload?.s !== 'm') throw new Error('not found');
	const m = pt.payload as unknown as Message;
	if (m.f !== uid) throw new Error('not author');
	const next = { ...m, x: new_text, e: Date.now() };
	await upsert(env, [
		{
			id: msg_id,
			vector: (pt.vector as number[] | undefined) ?? ZV,
			payload: next as unknown as Record<string, unknown>
		}
	]);
	return next;
}

export async function delete_msg(
	env: QEnv,
	uid: string,
	msg_id: string
): Promise<{ media_key?: string; c?: string; gr?: string; f: string; t: string }> {
	await ensure(env);
	const pt = await retrieve_one(env, msg_id);
	if (!pt || pt.payload?.s !== 'm') throw new Error('not found');
	const m = pt.payload as unknown as Message;
	if (m.f !== uid) {
		if (!m.gr) throw new Error('not author');
		const g = await get_group(env, m.gr);
		if (!g || g.owner !== uid) throw new Error('not author');
	}
	await remove(env, [msg_id]);
	return { media_key: m.im, c: m.c, gr: m.gr, f: m.f, t: m.t };
}

// the `/random` discover flow (and record_match, which wrote these) is gone, but existing
// `s:'x'` match records from before its removal must keep surfacing here — dropping these
// two reads would silently vanish already-visible threads for anyone who matched but never
// exchanged a message. Deliberately kept despite nothing writing new rows; revisit once the
// last pre-removal match record has aged out or been backfilled into a real conversation.
export async function list_conversations(
	env: QEnv,
	uid: string
): Promise<{ peer: string; last: number; preview: string }[]> {
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
		if (!cur || mt.d > cur.last)
			by_peer.set(peer, { last: mt.d, preview: 'you matched — say hi!' });
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
