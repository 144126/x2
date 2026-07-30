import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { send_msg, send_group_msg, conv_id, group_conv_id } from '$lib/server/chat';
import { get_group, is_member } from '$lib/server/group';
import { notify } from '$lib/server/notify';
import { total_unread } from '$lib/server/unread';
import { save_scheduled, MIN_LEAD_MS } from '$lib/server/scheduled';
import { is_muted, drop_muted } from '$lib/server/mute';

// A relay that throws, or answers in some shape other than `{ok, undelivered}`, is treated
// as if nobody received the message — better an extra push than a lost one.
async function relay(
	payload: Record<string, unknown>,
	ws: Fetcher
): Promise<{ ok: boolean; undelivered: string[] }> {
	console.log('[SEND→RELAY] posting to x2-ws /relay', payload);
	try {
		const res = await ws.fetch('https://x2-ws/relay', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(payload)
		});
		console.log('[SEND→RELAY] x2-ws responded', { status: res.status });
		const data = (await res.json().catch(() => null)) as { undelivered?: unknown } | null;
		console.log('[SEND→RELAY] x2-ws response body', data);
		if (!data || !Array.isArray(data.undelivered)) {
			const targets = (payload.to ? [payload.to] : (payload.members as string[])) as string[];
			console.warn(
				'[SEND→RELAY] malformed/missing undelivered array — treating all targets as undelivered',
				targets
			);
			return { ok: false, undelivered: targets };
		}
		console.log('[SEND→RELAY] undelivered targets:', data.undelivered);
		return { ok: true, undelivered: data.undelivered as string[] };
	} catch (e) {
		const targets = (payload.to ? [payload.to] : (payload.members as string[])) as string[];
		console.error(
			'[SEND→RELAY] fetch to x2-ws THREW — X2_WS service binding may be misconfigured',
			e,
			targets
		);
		return { ok: false, undelivered: targets };
	}
}

async function push(env: unknown, uids: string[], payload: Record<string, unknown>): Promise<void> {
	if (!uids.length) return;
	console.log('[SEND→PUSH] sending web push to', uids, payload);
	try {
		const r = await notify(env as never, uids, payload);
		console.log('[SEND→PUSH] notify() result', r);
	} catch (e) {
		console.error('[SEND→PUSH] notify() threw — push must never break sending', e);
	}
}

function bg_task(locals: App.Locals, p: Promise<unknown>): void {
	locals.bg?.(p);
}

export const POST: RequestHandler = async ({ request, locals }) => {
	console.log('[SEND] request received', { uid: locals.user?.id });
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
	console.log('[SEND] parsed body', {
		to,
		group,
		textLen: text.length,
		hasImage: !!image,
		hasFile: !!file,
		at: b?.at
	});

	if (b?.at && b.at > Date.now() + MIN_LEAD_MS) {
		const sm = await save_scheduled(env, me.id, { to, group, text, image, file, at: b.at });
		console.log('[SEND] scheduled instead of sending now', { id: sm.id, at: b.at });
		return json({ ok: true, scheduled: true, id: sm.id });
	}

	if (group) {
		const g = await get_group(env, group);
		if (!g) throw error(404, 'no group');
		if (!is_member(g, me.id)) throw error(403, 'not a member');
		const m = await send_group_msg(env, me.id, group, text, image, file);
		console.log('[SEND] group message stored', { id: m.id, group, members: g.members });
		// fan out to every member but the sender, whose UI already appended it
		const relay_payload = {
			members: g.members.filter((u) => u !== me.id),
			group,
			from: me.id,
			from_name: me.username,
			text,
			image,
			file,
			ts: m.d,
			id: m.id
		};
		const { undelivered } = await relay(relay_payload, locals.x2_ws);
		const targets = await drop_muted(env, group, undelivered.filter((u) => u !== me.id));

		// respond immediately; push notifications run in background
		bg_task(locals, (async () => {
			await Promise.all(
				targets.map(async (uid) => {
					const unread = await total_unread(env, uid, [group_conv_id(group)]);
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
		})());

		return json({
			ok: true,
			m: { id: m.id, from: m.f, group, text: m.x, image: m.im, file: m.fl, ts: m.d }
		});
	}

	if (!to) throw error(400, 'to or group required');
	const m = await send_msg(env, me.id, to, text, image, file);
	console.log('[SEND] 1:1 message stored', { id: m.id, from: me.id, to });
	const { undelivered } = await relay(
		{ id: m.id, to, from: me.id, from_name: me.username, text, image, file, ts: m.d },
		locals.x2_ws
	);
	console.log('[SEND] relay result', { to, undelivered });
	if (undelivered.includes(to) && !(await is_muted(env, to, me.id))) {
		console.log('[SEND] recipient was undelivered live, falling back to push notification');
		// respond immediately; push runs in background
		bg_task(locals, (async () => {
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
		})());
	}
	return json({
		ok: true,
		m: { id: m.id, from: m.f, to: m.t, text: m.x, image: m.im, file: m.fl, ts: m.d }
	});
};
