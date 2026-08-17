import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import {
	send_msg,
	send_group_msg,
	conv_id,
	group_conv_id,
	preview_of,
	type Draft
} from '$lib/server/chat';
import { get_group, is_member } from '$lib/server/group';
import { save_scheduled, MIN_LEAD_MS } from '$lib/server/scheduled';
import { guard } from '$lib/server/rl';
import { hub_conv } from '$lib/server/hub_client';
import { ensure_device_session } from '$lib/server/device';
import { remote_ok } from '$lib/stickers';

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
	} catch (e) {
		/* best-effort — but the conv index write loss on the recipient is a real diagnosis signal */
		console.error('[RELAY] send relay failed', e);
	}
}

export const POST: RequestHandler = async ({
	request,
	locals,
	platform,
	cookies,
	getClientAddress
}) => {
	const me =
		locals.user ?? (await ensure_device_session(env, platform, locals, cookies, getClientAddress));
	if (!me) throw error(401, 'auth');
	await guard(platform, 'RL_SEND', me.id);
	const b = (await request.json().catch(() => null)) as {
		to?: string;
		group?: string;
		text?: string;
		image?: string;
		file?: { key: string; name: string; size: number; type: string };
		at?: number;
		reply_to?: string;
		sticker?: string;
		forwarded?: boolean;
		view_once?: boolean;
	};
	const to = b?.to?.trim();
	const group = b?.group?.trim();
	const text = (b?.text ?? '').trim();
	const image = b?.image?.trim() || undefined;
	const file = b?.file;
	const reply_to = b?.reply_to?.trim() || undefined;
	const sticker = b?.sticker?.trim() || undefined;
	if (sticker?.startsWith('https://') && !remote_ok(sticker)) throw error(400, 'bad sticker');
	const forwarded = b?.forwarded ? true : undefined;
	if (!text && !image && !file && !sticker)
		throw error(400, 'text, image, file or sticker required');
	if (!to && !group) throw error(400, 'to or group required');

	const view_once = !!b?.view_once;
	// a forward of a view-once message would be a second view, granted by the one person who
	// already spent theirs — the content is gone by then anyway, so refuse it outright
	if (view_once && forwarded) throw error(400, 'cannot forward as view once');
	const draft: Draft = { text, image, file, reply_to, sticker, forwarded, view_once };
	const preview = preview_of(draft);

	if (b?.at && b.at > Date.now() + MIN_LEAD_MS) {
		const sm = await save_scheduled(env, me.id, { to, group, text, image, file, at: b.at });
		return json({ ok: true, scheduled: true, id: sm.id });
	}

	if (group) {
		const g = await get_group(env, group);
		if (!g) throw error(404, 'no group');
		if (!(await is_member(env, locals.x2_ws, g.id, me.id))) throw error(403, 'not a member');
		const m = await send_group_msg(env, me.id, group, draft).catch((e) => {
			console.error('[SEND] not_stored', e);
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
						// a view-once message travels as a knock on the door: kind only, no content,
						// so a socket frame or a push payload is never a second copy of it
						...(view_once
							? { vo: 1, vk: m.vk }
							: { text, image, file, sticker, ...(image ? { image: `/media/${image}` } : {}) }),
						fw: forwarded || undefined,
						ts: m.d,
						conv: group_conv_id(group),
						mute_key: group,
						title: g.name,
						push_body: `${me.username}: ${preview}`,
						url: `/~${group}`,
						kind: 'r',
						reply_to: group,
						reply_msg: reply_to
					},
					locals.x2_ws
				),
				hub_conv(
					env,
					locals.x2_ws,
					me.id,
					group_conv_id(group),
					{ group },
					m.d,
					preview
				).catch((e) => console.error('[HUB-CONV] sender self-index failed', e))
			])
		);

		return json({
			ok: true,
			m: { id: m.id, from: m.f, group, ts: m.d, rp: m.rp, fw: m.fw, vo: m.vo, vk: m.vk }
		});
	}

	if (!to) throw error(400, 'to or group required');
	const m = await send_msg(env, me.id, to, draft).catch((e) => {
		console.error('[SEND] not_stored', e);
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
					...(view_once
						? { vo: 1, vk: m.vk }
						: { text, image, file, sticker, ...(image ? { image: `/media/${image}` } : {}) }),
					fw: forwarded || undefined,
					ts: m.d,
					conv: conv_id(me.id, to),
					mute_key: me.id,
					title: me.username,
					push_body: preview,
					url: `/chat/${me.id}`,
					kind: 'u',
					reply_to: me.id,
					reply_msg: reply_to
				},
				locals.x2_ws
			),
			hub_conv(
				env,
				locals.x2_ws,
				me.id,
				conv_id(me.id, to),
				{ peer: to },
				m.d,
				preview
			).catch((e) => console.error('[HUB-CONV] sender self-index failed', e))
		])
	);

	return json({
		ok: true,
		m: { id: m.id, from: m.f, to: m.t, ts: m.d, rp: m.rp, fw: m.fw, vo: m.vo, vk: m.vk }
	});
};
