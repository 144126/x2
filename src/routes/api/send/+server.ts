import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { send_msg, send_group_msg, backfill_vector, conv_id, group_conv_id } from '$lib/server/chat';
import { get_group, is_member } from '$lib/server/group';
import { notify } from '$lib/server/notify';
import { total_unread, total_unread_for_group } from '$lib/server/unread';
import { scroll, f, eq } from '$lib/server/qdrant';
import { save_scheduled, MIN_LEAD_MS } from '$lib/server/scheduled';
import { is_muted, drop_muted } from '$lib/server/mute';

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
		/* best-effort */
	}
}

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) throw error(401, 'auth');
	const b = (await request.json().catch(() => null)) as {
		to?: string;
		group?: string;
		text?: string;
		image?: string;
		file?: { key: string; name: string; size: number; type: string };
		at?: number;
	};
	const to = b?.to?.trim();
	const group = b?.group?.trim();
	const text = (b?.text ?? '').trim();
	const image = b?.image?.trim() || undefined;
	const file = b?.file;
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
		if (!is_member(g, me.id)) throw error(403, 'not a member');
		const m = await send_group_msg(env, me.id, group, text, image, file).catch(() => {
			throw error(503, 'not_stored');
		});

		const fanout = async () => {
			const { undelivered } = await relay(
				{
					id: m.id,
					members: g.members.filter((u) => u !== me.id),
					group,
					from: me.id,
					from_name: me.username,
					text,
					image,
					file,
					ts: m.d
				},
				locals.x2_ws
			);
			const targets = await drop_muted(env, group, undelivered.filter((u) => u !== me.id));
			const group_msgs = (await scroll(env, f(eq('s', 'm'), eq('c', group_conv_id(group))), 1000))
				.map((p) => p.payload as import('$lib/types').Message);
			await Promise.all(
				targets.map(async (uid) => {
					const unread = await total_unread_for_group(env, uid, group_msgs, group_conv_id(group));
					await push(env, [uid], {
						title: g.name,
						body: file ? `${me.username}: 📎 ${file.name}` : `${me.username}: ${text}`,
						url: `/app/rooms/${group}`,
						conv: group_conv_id(group),
						id: m.id,
						ts: m.d,
						kind: 'r',
						reply_to: group,
						unread,
						...(image ? { image: `/media/${image}` } : {})
					});
				})
			);
		};

		locals.bg(Promise.all([fanout(), backfill_vector(env, m.id, text)]));

		return json({
			ok: true,
			m: { id: m.id, from: m.f, group, text: m.x, image: m.im, file: m.fl, ts: m.d }
		});
	}

	if (!to) throw error(400, 'to or group required');
	const m = await send_msg(env, me.id, to, text, image, file).catch(() => {
		throw error(503, 'not_stored');
	});

	const fanout = async () => {
		const { undelivered } = await relay(
			{ id: m.id, to, from: me.id, from_name: me.username, text, image, file, ts: m.d },
			locals.x2_ws
		);
		if (!undelivered.includes(to)) return;
		if (await is_muted(env, to, me.id)) return;
		const unread = await total_unread(env, to);
		await push(env, [to], {
			title: me.username,
			body: file ? `📎 ${file.name}` : text,
			url: `/app/chat/${me.id}`,
			conv: conv_id(me.id, to),
			id: m.id,
			ts: m.d,
			kind: 'u',
			reply_to: me.id,
			unread,
			...(image ? { image: `/media/${image}` } : {})
		});
	};

	locals.bg(Promise.all([fanout(), backfill_vector(env, m.id, text)]));

	return json({
		ok: true,
		m: { id: m.id, from: m.f, to: m.t, text: m.x, image: m.im, file: m.fl, ts: m.d }
	});
};
