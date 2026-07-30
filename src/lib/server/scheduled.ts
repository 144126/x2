import type { ScheduledMessage, Message } from '../types';
import { ensure, upsert, scroll, remove, new_id, f, eq, range, type QEnv } from './qdrant';
import { send_msg, send_group_msg, backfill_vector, conv_id, group_conv_id } from './chat';
import { get_group, is_member } from './group';

export const MIN_LEAD_MS = 60_000; // schedule at least 1 minute out, otherwise just send now

export async function save_scheduled(
	env: QEnv,
	from: string,
	opts: {
		to?: string;
		group?: string;
		text: string;
		image?: string;
		file?: Message['fl'];
		at: number;
	}
): Promise<ScheduledMessage> {
	await ensure(env);
	const sm: ScheduledMessage = {
		s: 'sm',
		id: new_id(),
		f: from,
		to: opts.to,
		group: opts.group,
		text: opts.text,
		image: opts.image,
		file: opts.file,
		at: opts.at,
		sent: 0
	};
	await upsert(env, [
		{
			id: sm.id,
			vector: {},
			payload: sm as unknown as Record<string, unknown>
		}
	]);
	return sm;
}

export async function list_scheduled(env: QEnv, uid: string): Promise<ScheduledMessage[]> {
	await ensure(env);
	const pts = await scroll(env, f(eq('s', 'sm'), eq('f', uid), eq('sent', 0)), 200);
	return pts.map((p) => p.payload as unknown as ScheduledMessage).sort((a, b) => a.at - b.at);
}

export async function cancel_scheduled(env: QEnv, uid: string, id: string): Promise<boolean> {
	await ensure(env);
	const pts = await scroll(env, f(eq('s', 'sm'), eq('f', uid), eq('sent', 0)), 200);
	if (!pts.some((p) => p.id === id)) return false;
	await remove(env, [id]);
	return true;
}

export async function due_scheduled(env: QEnv, now: number): Promise<ScheduledMessage[]> {
	await ensure(env);
	const pts = await scroll(env, f(eq('s', 'sm'), eq('sent', 0), range('at', undefined, now)), 500);
	return pts.map((p) => p.payload as unknown as ScheduledMessage);
}

async function mark_sent(env: QEnv, sm: ScheduledMessage): Promise<void> {
	await upsert(env, [
		{
			id: sm.id,
			vector: {},
			payload: { ...sm, sent: 1 } as unknown as Record<string, unknown>
		}
	]);
}

// Best-effort: the message is already durably stored by the time this runs. The recipient's
// own ChatHub Durable Object decides delivery, unread count and push from here — see
// plan/scale.plan.json -> hub_owns_delivery.
async function relay(ws: Fetcher, payload: Record<string, unknown>): Promise<void> {
	try {
		await ws.fetch('https://x2-ws/relay', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(payload)
		});
	} catch {
		/* best-effort — the message is already durably stored and marked sent */
	}
}

/** dispatches every due scheduled message. Never throws — a delivery failure never blocks
 *  marking the message sent, mirroring /api/send's "never lose the message" philosophy. */
export async function send_scheduled_batch(env: QEnv, ws: Fetcher, now: number): Promise<void> {
	const due = await due_scheduled(env, now);
	for (const sm of due) {
		try {
			if (sm.group) {
				const g = await get_group(env, sm.group);
				if (g && (await is_member(env, ws, g.id, sm.f))) {
					const m = await send_group_msg(env, sm.f, sm.group, sm.text, sm.image, sm.file);
					await backfill_vector(env, m.id, sm.text);
					await relay(ws, {
						id: m.id,
						members: g.members.filter((u) => u !== sm.f),
						group: sm.group,
						from: sm.f,
						text: sm.text,
						image: sm.image,
						file: sm.file,
						ts: m.d,
						conv: group_conv_id(sm.group),
						mute_key: sm.group,
						title: g.name,
						push_body: sm.file ? `📎 ${sm.file.name}` : sm.text,
						url: `/app/rooms/${sm.group}`,
						kind: 'r',
						reply_to: sm.group
					});
				}
			} else if (sm.to) {
				const m = await send_msg(env, sm.f, sm.to, sm.text, sm.image, sm.file);
				await backfill_vector(env, m.id, sm.text);
				await relay(ws, {
					id: m.id,
					to: sm.to,
					from: sm.f,
					text: sm.text,
					image: sm.image,
					file: sm.file,
					ts: m.d,
					conv: conv_id(sm.f, sm.to),
					mute_key: sm.f,
					title: sm.f,
					push_body: sm.file ? `📎 ${sm.file.name}` : sm.text,
					url: `/app/chat/${sm.f}`,
					kind: 'u',
					reply_to: sm.f
				});
			}
		} finally {
			await mark_sent(env, sm);
		}
	}
}
