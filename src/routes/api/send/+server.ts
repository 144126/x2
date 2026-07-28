import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { send_msg, send_group_msg } from '$lib/server/chat';
import { get_group, is_member } from '$lib/server/group';

async function relay(payload: Record<string, unknown>, ws: Fetcher): Promise<void> {
	await ws
		.fetch('https://x2-ws/relay', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(payload)
		})
		.catch(() => {});
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
		await relay(
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
		return json({ ok: true, m: { id: m.id, from: m.f, group, text: m.x, image: m.im, ts: m.d } });
	}

	if (!to) throw error(400, 'to or group required');
	const m = await send_msg(env, me.id, to, text, image);
	await relay({ id: m.id, to, from: me.id, from_name: me.username, text, image, ts: m.d }, locals.x2_ws);
	return json({ ok: true, m: { id: m.id, from: m.f, to: m.t, text: m.x, image: m.im, ts: m.d } });
};
