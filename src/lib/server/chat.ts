import type { Message } from '../types';
import { msg_kind, KIND_LABEL } from '../types';
import {
	ensure,
	upsert,
	retrieve_one,
	new_id,
	type QEnv,
	f,
	eq,
	scroll,
	set_payload,
	clear_payload
} from './qdrant';
import { get_group, is_member } from './group';
import { encrypt_text, decrypt_text } from './msg_crypto';
import { redacted, media_key } from './viewonce';
import { purge_key } from './media';
export { get_user_name, get_user_names } from './user';

export { ensure };

export function conv_id(a: string, b: string): string {
	return [a, b].sort().join('|');
}

/** everything a caller decides about one outgoing message */
export type Draft = {
	text: string;
	image?: string;
	file?: Message['fl'];
	reply_to?: string;
	sticker?: string;
	forwarded?: boolean;
	view_once?: boolean;
};

async function store(env: QEnv, base: Pick<Message, 'c' | 'f' | 't' | 'gr'>, d: Draft) {
	await ensure(env);
	const m: Message = {
		s: 'm',
		id: new_id(),
		...base,
		x: d.text,
		...(d.image ? { im: d.image } : {}),
		...(d.file ? { fl: d.file } : {}),
		...(d.reply_to ? { rp: d.reply_to } : {}),
		...(d.sticker ? { sk: d.sticker } : {}),
		...(d.forwarded ? { fw: true } : {}),
		d: Date.now()
	};
	// the kind is recorded up front because it is the one thing a view-once message still has
	// to be able to say about itself after the content is gone
	if (d.view_once) {
		m.vo = 1;
		m.vk = msg_kind(m);
	}
	await upsert(env, [
		{
			id: m.id,
			vector: {},
			payload: { ...m, x: await encrypt_text(env, d.text) } as unknown as Record<string, unknown>
		}
	]);
	return m;
}

export async function send_msg(env: QEnv, from: string, to: string, d: Draft): Promise<Message> {
	return store(env, { c: conv_id(from, to), f: from, t: to }, d);
}

// group messages reuse the message record and its `c` index: one conversation per group
export const group_conv_id = (gid: string): string => `g:${gid}`;

export async function send_group_msg(
	env: QEnv,
	from: string,
	group: string,
	d: Draft
): Promise<Message> {
	return store(env, { c: group_conv_id(group), f: from, t: '', gr: group }, d);
}

/** what the conversation list and a push notification are allowed to say about a message */
export function preview_of(d: Draft): string {
	if (d.view_once) return `view once ${KIND_LABEL[msg_kind({ im: d.image, fl: d.file, sk: d.sticker })]}`;
	if (d.text) return d.text;
	if (d.image) return '📷 image';
	if (d.file) return d.file.type.startsWith('audio/') ? '🎤 voice note' : '📎 file';
	if (d.sticker) return 'sticker';
	return 'message';
}

export const PAGE = 50;

/** the tombstone left where a message deleted for everyone used to be */
function tomb(m: Message): Message {
	return { s: 'm', id: m.id, c: m.c, f: m.f, t: m.t, ...(m.gr ? { gr: m.gr } : {}), x: '', d: m.d, dx: m.dx };
}

/**
 * The single door every stored message goes through on its way to a person. Deletion and
 * view-once are decided here rather than in each route, so a new reader of the thread cannot
 * forget to apply them — and so a client is never sent something it is then trusted to hide.
 *
 * Returns null when this reader should not see the message at all.
 */
export async function present(env: QEnv, m: Message, uid: string): Promise<Message | null> {
	if (m.dl?.includes(uid)) return null;
	if (m.dx) return tomb(m);
	if (m.vo) return redacted(m);
	return { ...m, x: await decrypt_text(env, m.x) };
}

async function page_msgs(
	env: QEnv,
	conv: string,
	uid: string,
	before?: number
): Promise<Message[]> {
	const pts = await scroll(env, f(eq('s', 'm'), eq('c', conv)), PAGE, undefined, {
		key: 'd',
		direction: 'desc',
		...(before === undefined ? {} : { start_from: before - 1 })
	});
	const msgs = await Promise.all(
		pts.map((p) => present(env, p.payload as unknown as Message, uid))
	);
	return msgs.filter((m): m is Message => !!m).sort((x, y) => x.d - y.d);
}

export async function get_messages(
	env: QEnv,
	a: string,
	b: string,
	before?: number
): Promise<Message[]> {
	await ensure(env);
	return page_msgs(env, conv_id(a, b), a, before);
}

export async function get_group_messages(
	env: QEnv,
	group: string,
	uid: string,
	before?: number
): Promise<Message[]> {
	await ensure(env);
	return page_msgs(env, group_conv_id(group), uid, before);
}

/** the raw stored record — only for code that is about to decide what a reader may see */
export async function get_message_raw(env: QEnv, id: string): Promise<Message | null> {
	const pt = await retrieve_one(env, id);
	if (!pt || pt.payload?.s !== 'm') return null;
	return pt.payload as unknown as Message;
}

export async function get_message(
	env: QEnv,
	id: string,
	uid: string
): Promise<Message | null> {
	const m = await get_message_raw(env, id);
	return m ? present(env, m, uid) : null;
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
			payload: { ...next, x: await encrypt_text(env, new_text) } as unknown as Record<
				string,
				unknown
			>
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

/** the one participation test — a room member, or one of the two people in a thread */
export async function may_read(
	env: QEnv,
	ws: Fetcher,
	m: Message,
	uid: string
): Promise<boolean> {
	return m.gr ? is_member(env, ws, m.gr, uid) : m.f === uid || m.t === uid;
}

export async function may_delete_for_all(env: QEnv, uid: string, m: Message): Promise<boolean> {
	if (m.f === uid) return true;
	if (!m.gr) return false;
	return (await get_group(env, m.gr))?.owner === uid;
}

/**
 * Delete for everyone. The record stays as a tombstone and the content goes: the text is
 * blanked, the attachment keys are removed, and the object itself is deleted out of R2. A
 * tombstone rather than a hole because a thread that silently loses a message is worse than
 * one that says a message was taken back — and because a reply quoting it still has to
 * resolve to something.
 */
export async function delete_msg(
	env: QEnv,
	bucket: MediaBucket | undefined,
	uid: string,
	msg_id: string
): Promise<{ c: string; gr?: string; f: string; t: string }> {
	await ensure(env);
	const m = await get_message_raw(env, msg_id);
	if (!m) throw new Error('not found');
	if (!(await may_delete_for_all(env, uid, m))) throw new Error('not author');

	const key = media_key(m);
	await set_payload(env, msg_id, { dx: Date.now(), x: '' });
	await clear_payload(env, msg_id, ['im', 'fl', 'sk', 'rx', 'vw', 'vk', 'vo', 'vd']);
	if (key) await purge_key(bucket, key);
	return { c: m.c, gr: m.gr, f: m.f, t: m.t };
}

/**
 * Delete for me. Nobody else's copy changes, and the attachment stays put — it is still the
 * other person's message. Recorded on the message rather than per-device so it holds on
 * every device the user signs in from.
 */
export async function delete_msg_for_me(env: QEnv, uid: string, m: Message): Promise<void> {
	await ensure(env);
	if (m.dl?.includes(uid)) return;
	await set_payload(env, m.id, { dl: [...(m.dl ?? []), uid] });
}
