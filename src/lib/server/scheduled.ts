import type { ScheduledMessage, Message } from '../types';
import { ensure, upsert, scroll, remove, new_id, f, eq, range, type QEnv } from './qdrant';
import { send_msg, send_group_msg, conv_id, group_conv_id } from './chat';
import { get_group, is_member } from './group';
import { notify } from './notify';

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
	await upsert(env, [{ id: sm.id, vector: new Array(4096).fill(0), payload: sm as unknown as Record<string, unknown> }]);
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
		{ id: sm.id, vector: new Array(4096).fill(0), payload: { ...sm, sent: 1 } as unknown as Record<string, unknown> }
	]);
}

async function push(env: unknown, uids: string[], payload: Record<string, unknown>): Promise<void> {
	if (!uids.length) return;
	try {
		await notify(env as never, uids, payload);
	} catch {
		/* push must never break sending */
	}
}

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
				if (g && is_member(g, sm.f)) {
					const m = await send_group_msg(env, sm.f, sm.group, sm.text, sm.image, sm.file);
					await relay(ws, {
						members: g.members.filter((u) => u !== sm.f),
						group: sm.group,
						from: sm.f,
						text: sm.text,
						image: sm.image,
						file: sm.file,
						ts: m.d
					});
					await push(env, g.members.filter((u) => u !== sm.f), {
						title: g.name,
						body: sm.file ? `📎 ${sm.file.name}` : sm.text,
						url: `/app/groups/${sm.group}`,
						conv: group_conv_id(sm.group),
						id: m.id,
						ts: m.d
					});
				}
			} else if (sm.to) {
				const m = await send_msg(env, sm.f, sm.to, sm.text, sm.image, sm.file);
				await relay(ws, { id: m.id, to: sm.to, from: sm.f, text: sm.text, image: sm.image, file: sm.file, ts: m.d });
				await push(env, [sm.to], {
					title: sm.f,
					body: sm.file ? `📎 ${sm.file.name}` : sm.text,
					url: `/app/chat/${sm.f}`,
					conv: conv_id(sm.f, sm.to),
					id: m.id,
					ts: m.d
				});
			}
		} finally {
			await mark_sent(env, sm);
		}
	}
}
