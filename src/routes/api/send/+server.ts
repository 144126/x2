import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { send_msg, send_group_msg, backfill_vector, conv_id, group_conv_id } from '$lib/server/chat';
import { get_group, is_member } from '$lib/server/group';
import { save_scheduled, MIN_LEAD_MS } from '$lib/server/scheduled';
import { guard } from '$lib/server/rl';
import { hub_conv } from '$lib/server/hub_client';

// Best-effort: the message is already durably stored by the time this runs. The recipient's
// own ChatHub Durable Object decides delivery, unread count and push from here — see
// plan/scale.plan.json -> hub_owns_delivery.
async function relay(payload: Record<string, unknown>, ws: Fetcher): Promise<void> {
	try {
		await ws.fetch('https://x2-ws/relay', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(payload)
		});
	} catch {
		/* best-effort */
	}
}

export const POST: RequestHandler = async ({ request, locals, platform }) => {
	if (!locals.user) throw error(401, 'auth');
	await guard(platform, 'RL_SEND', locals.user.id);
	const b = (await request.json().catch(() => null)) as {
		to?: string;
		group?: string;
		text?: string;
		image?: string;
		file?: { key: string; name: string; size: number; type: string };
		at?: number;
		reply_to?: string;
	};
	const to = b?.to?.trim();
	const group = b?.group?.trim();
	const text = (b?.text ?? '').trim();
	const image = b?.image?.trim() || undefined;
	const file = b?.file;
	const reply_to = b?.reply_to?.trim() || undefined;
	if (!text && !image && !file) throw error(400, 'text, image or file required');
	if (!to && !group) throw error(400, 'to or group required');

	const me = locals.user;

	if (b?.at && b.at > Date.now() + MIN_LEAD_MS) {
		const sm = await save_scheduled(env, me.id, { to, group, text, image, file, at: b.at });
		return json({ ok: true, scheduled: true, id: sm.id });
	}

	if (group) {
		const g = await get_group(env, group);
		if (!g) throw error(404, 'no group');
		if (!(await is_member(env, locals.x2_ws, g.id, me.id))) throw error(403, 'not a member');
		const m = await send_group_msg(env, me.id, group, text, image, file, reply_to).catch(() => {
			throw error(503, 'not_stored');
		});

		locals.bg(
			Promise.all([
				relay(
					{
						id: m.id,
						members: g.members.filter((u) => u !== me.id),
						group,
						from: me.id,
						from_name: me.username,
						text,
						image,
						file,
						ts: m.d,
						conv: group_conv_id(group),
						mute_key: group,
						title: g.name,
						push_body: file ? `${me.username}: 📎 ${file.name}` : `${me.username}: ${text}`,
						url: `/app/rooms/${group}`,
						kind: 'r',
						reply_to: group,
						reply_msg: reply_to,
						...(image ? { image: `/media/${image}` } : {})
					},
					locals.x2_ws
				),
				backfill_vector(env, m.id, text),
				hub_conv(env, locals.x2_ws, me.id, group_conv_id(group), { group }, m.d, text || (file ? '📎 file' : '📷 image')).catch(() => {})
			])
		);

		return json({
			ok: true,
			m: { id: m.id, from: m.f, group, text: m.x, image: m.im, file: m.fl, ts: m.d, rp: m.rp }
		});
	}

	if (!to) throw error(400, 'to or group required');
	const m = await send_msg(env, me.id, to, text, image, file, reply_to).catch(() => {
		throw error(503, 'not_stored');
	});

	locals.bg(
		Promise.all([
			relay(
				{
					id: m.id,
					to,
					from: me.id,
					from_name: me.username,
					text,
					image,
					file,
					ts: m.d,
					conv: conv_id(me.id, to),
					mute_key: me.id,
					title: me.username,
					push_body: file ? `📎 ${file.name}` : text,
					url: `/app/chat/${me.id}`,
					kind: 'u',
					reply_to: me.id,
					reply_msg: reply_to,
					...(image ? { image: `/media/${image}` } : {})
				},
				locals.x2_ws
			),
			backfill_vector(env, m.id, text),
			hub_conv(env, locals.x2_ws, me.id, conv_id(me.id, to), { peer: to }, m.d, text || (file ? '📎 file' : '📷 image')).catch(() => {})
		])
	);

	return json({
		ok: true,
		m: { id: m.id, from: m.f, to: m.t, text: m.x, image: m.im, file: m.fl, ts: m.d, rp: m.rp }
	});
};
