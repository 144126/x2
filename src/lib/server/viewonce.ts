import { error } from '@sveltejs/kit';
import type { Message } from '../types';
import { msg_kind } from '../types';
import { retrieve_one, set_payload, clear_payload, type QEnv } from './qdrant';
import { decrypt_text } from './msg_crypto';
import { get_group } from './group';
import { get_image, purge_key } from './media';

/**
 * Who still owes this message a look. The sender is never on the list: they wrote it, and
 * letting them reopen it would make "view once" mean "view once, plus whenever the person
 * holding the sender's phone likes".
 */
export async function recipients_of(env: QEnv, m: Message): Promise<string[]> {
	if (!m.gr) return m.t ? [m.t] : [];
	const g = await get_group(env, m.gr);
	return (g?.members ?? []).filter((u) => u !== m.f);
}

export function media_key(m: Message): string | undefined {
	return m.im ?? m.fl?.key;
}

/** everything a burnt or unopened view-once message is allowed to say about itself */
export function redacted(m: Message): Message {
	return {
		s: 'm',
		id: m.id,
		c: m.c,
		f: m.f,
		t: m.t,
		...(m.gr ? { gr: m.gr } : {}),
		...(m.rp ? { rp: m.rp } : {}),
		...(m.fw ? { fw: true as const } : {}),
		x: '',
		d: m.d,
		vo: 1,
		vk: m.vk ?? msg_kind(m),
		...(m.vw?.length ? { vw: m.vw } : {}),
		...(m.vd ? { vd: m.vd } : {})
	};
}

export type Burnt = {
	kind: NonNullable<Message['vk']>;
	text: string;
	sticker?: string;
	file?: { name: string; size: number; type: string };
	body?: ArrayBuffer;
	/** content type of the bytes, taken from R2 rather than guessed from the key */
	type?: string;
	/** true once this was the last pair of eyes and the content no longer exists anywhere */
	gone: boolean;
};

/**
 * Spends one recipient's single view and hands back the content in the same breath.
 *
 * The bytes are pulled out of R2 and into this response *before* the object is deleted, so
 * the last viewer cannot lose the race against the deletion that their own view triggers.
 * Nothing here mints a URL: a URL is a thing that can be pasted, cached, or reloaded, and a
 * view-once message must not survive any of those.
 */
export async function open_view_once(
	env: QEnv,
	bucket: MediaBucket | undefined,
	m: Message,
	uid: string
): Promise<Burnt> {
	if (!m.vo) throw error(400, 'not_view_once');
	if (m.f === uid) throw error(403, 'sender_cannot_reopen');
	if (m.vd || m.vw?.includes(uid)) throw error(410, 'already_viewed');

	const key = media_key(m);
	const obj = key && bucket ? await get_image(bucket, key) : null;
	const body = obj ? await obj.arrayBuffer() : undefined;
	if (key && !body) throw error(410, 'already_viewed');

	const vw = [...(m.vw ?? []), uid];
	const left = (await recipients_of(env, m)).filter((r) => !vw.includes(r));
	const gone = left.length === 0;

	// The write happens after the bytes are in hand and before they go out, so a reader who
	// dies mid-response has still spent their view. Losing the content is the safe failure.
	await set_payload(env, m.id, { vw, vk: m.vk ?? msg_kind(m), ...(gone ? { vd: Date.now(), x: '' } : {}) });
	if (gone) {
		await clear_payload(env, m.id, ['im', 'fl', 'sk']);
		if (key) await purge_key(bucket, key);
	}

	return {
		kind: m.vk ?? msg_kind(m),
		text: await decrypt_text(env, m.x),
		sticker: m.sk,
		file: m.fl ? { name: m.fl.name, size: m.fl.size, type: m.fl.type } : undefined,
		body,
		type: obj?.httpMetadata?.contentType || m.fl?.type,
		gone
	};
}

/** re-reads the message so a caller never burns a view against a stale copy */
export async function fresh(env: QEnv, id: string): Promise<Message | null> {
	const pt = await retrieve_one(env, id);
	return pt?.payload?.s === 'm' ? (pt.payload as unknown as Message) : null;
}
