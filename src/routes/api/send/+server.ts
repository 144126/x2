import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { send_msg, send_group_msg, conv_id, group_conv_id } from '$lib/server/chat';
import { get_group, is_member } from '$lib/server/group';
import { notify } from '$lib/server/notify';
import { total_unread } from '$lib/server/unread';

// A relay that throws, or answers in some shape other than `{ok, undelivered}`, is treated
// as if nobody received the message — better an extra push than a lost one.
async function relay(
	payload: Record<string, unknown>,
	ws: Fetcher
): Promise<{ ok: boolean; undelivered: string[] }> {
	try {
		const res = await ws.fetch('https://x2-ws/relay', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(payload)
		});
		const data = (await res.json().catch(() => null)) as { undelivered?: unknown } | null;
		if (!data || !Array.isArray(data.undelivered)) {
			const targets = (payload.to ? [payload.to] : (payload.members as string[])) as string[];
			return { ok: false, undelivered: targets };
		}
		return { ok: true, undelivered: data.undelivered as string[] };
	} catch {
		const targets = (payload.to ? [payload.to] : (payload.members as string[])) as string[];
		return { ok: false, undelivered: targets };
	}
}

async function push(env: unknown, uids: string[], payload: Record<string, unknown>): Promise<void> {
	if (!uids.length) return;
	try {
		await notify(env as never, uids, payload);
	} catch {
		/* push must never break sending */
	}
}

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) throw error(401, 'auth');
	const b = (await request.json().catch(() => null)) as {
		to?: string;
		group?: string;
		text?: string;
		image?: string;
	};
	const to = b?.to?.trim();
	const group = b?.group?.trim();
	const text = (b?.text ?? '').trim();
	const image = b?.image?.trim() || undefined;
	if (!text && !image) throw error(400, 'text or image required');

	const me = locals.user;

	if (group) {
		const g = await get_group(env, group);
		if (!g) throw error(404, 'no group');
		if (!is_member(g, me.id)) throw error(403, 'not a member');
		const m = await send_group_msg(env, me.id, group, text, image);
		// fan out to every member but the sender, whose UI already appended it
		const { undelivered } = await relay(
			{
				members: g.members.filter((u) => u !== me.id),
				group,
				from: me.id,
				from_name: me.username,
				text,
				image,
				ts: m.d
			},
			locals.x2_ws
		);
		const targets = undelivered.filter((u) => u !== me.id);
		await push(env, targets, {
			title: g.name,
			body: `${me.username}: ${text}`,
			url: `/app/groups/${group}`,
			conv: group_conv_id(group),
			id: m.id,
			ts: m.d,
			...(image ? { image: `/media/${image}` } : {})
		});
		return json({ ok: true, m: { id: m.id, from: m.f, group, text: m.x, image: m.im, ts: m.d } });
	}

	if (!to) throw error(400, 'to or group required');
	const m = await send_msg(env, me.id, to, text, image);
	const { undelivered } = await relay(
		{ id: m.id, to, from: me.id, from_name: me.username, text, image, ts: m.d },
		locals.x2_ws
	);
	if (undelivered.includes(to)) {
		const unread = await total_unread(env, to);
		await push(env, [to], {
			title: me.username,
			body: text,
			url: `/app/chat/${me.id}`,
			conv: conv_id(me.id, to),
			id: m.id,
			ts: m.d,
			unread,
			...(image ? { image: `/media/${image}` } : {})
		});
	}
	return json({ ok: true, m: { id: m.id, from: m.f, to: m.t, text: m.x, image: m.im, ts: m.d } });
};
