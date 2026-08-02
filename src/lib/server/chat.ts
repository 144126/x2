import type { Message } from '../types';
import { ensure, upsert, retrieve_one, remove, new_id, type QEnv, f, f_or, eq, scroll, search, ZV, update_vectors, set_payload } from './qdrant';
import { embed } from './or';
import { get_group } from './group';
import { encrypt_text, decrypt_text } from './msg_crypto';
export { get_user_name, get_user_names } from './user';

export { ensure };

export function conv_id(a: string, b: string): string {
	return [a, b].sort().join('|');
}

// The embedding call is ~900ms (measured 660-1195ms against api.voxell.ai), so messages are
// inserted with no vector at all (vector: {} — see named_vector_migration) and get one patched
// in afterwards, only if the text is long enough to be worth searching. Callers hand this to
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
	file?: Message['fl'],
	reply_to?: string,
	sticker?: string,
	forwarded?: boolean
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
		...(reply_to ? { rp: reply_to } : {}),
		...(sticker ? { sk: sticker } : {}),
		...(forwarded ? { fw: true } : {}),
		d: Date.now()
	};
	await upsert(env, [
		{
			id: m.id,
			vector: {},
			payload: { ...m, x: await encrypt_text(env, text) } as unknown as Record<string, unknown>
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
	file?: Message['fl'],
	reply_to?: string,
	sticker?: string,
	forwarded?: boolean
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
		...(reply_to ? { rp: reply_to } : {}),
		...(sticker ? { sk: sticker } : {}),
		...(forwarded ? { fw: true } : {}),
		d: Date.now()
	};
	await upsert(env, [
		{
			id: m.id,
			vector: {},
			payload: { ...m, x: await encrypt_text(env, text) } as unknown as Record<string, unknown>
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
	return Promise.all(
		pts.map(async (p) => {
			const m = p.payload as unknown as Message;
			return { ...m, x: await decrypt_text(env, m.x) };
		})
	);
}

export const PAGE = 50;

async function page_msgs(env: QEnv, conv: string, before?: number): Promise<Message[]> {
	const pts = await scroll(env, f(eq('s', 'm'), eq('c', conv)), PAGE, undefined, {
		key: 'd',
		direction: 'desc',
		...(before === undefined ? {} : { start_from: before - 1 })
	});
	const msgs = await Promise.all(
		pts.map(async (p) => {
			const m = p.payload as unknown as Message;
			return { ...m, x: await decrypt_text(env, m.x) };
		})
	);
	return msgs.sort((x, y) => x.d - y.d);
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

export async function get_message(env: QEnv, id: string): Promise<Message | null> {
	const pt = await retrieve_one(env, id);
	if (!pt || pt.payload?.s !== 'm') return null;
	const m = pt.payload as unknown as Message;
	return { ...m, x: await decrypt_text(env, m.x) };
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
			vector: pt.vector ?? {},
			payload: { ...next, x: await encrypt_text(env, new_text) } as unknown as Record<string, unknown>
		}
	]);
	return next;
}

export async function toggle_reaction(
	env: QEnv,
	uid: string,
	msg_id: string,
	emoji: string
): Promise<Record<string, string[]>> {
	await ensure(env);
	const pt = await retrieve_one(env, msg_id);
	if (!pt || pt.payload?.s !== 'm') throw new Error('not found');
	const m = pt.payload as unknown as Message;
	const rx = { ...(m.rx ?? {}) };
	const set = new Set(rx[emoji] ?? []);
	if (set.has(uid)) set.delete(uid);
	else set.add(uid);
	if (set.size) rx[emoji] = [...set];
	else delete rx[emoji];
	await set_payload(env, msg_id, { rx });
	return rx;
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


