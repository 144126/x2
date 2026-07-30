import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { edit_msg, backfill_vector } from '$lib/server/chat';
import { get_group, is_member } from '$lib/server/group';

export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) throw error(401, 'auth');
	const { id } = params;
	const b = (await request.json().catch(() => null)) as { text?: string } | null;
	const text = b?.text?.trim();
	if (!text) throw error(400, 'text required');

	const m = await edit_msg(env, locals.user.id, id, text);
	locals.bg(backfill_vector(env, m.id, m.x));

	const targets: string[] = [];
	if (m.gr) {
		const g = await get_group(env, m.gr);
		if (g) targets.push(...g.members.filter((u) => u !== m.f));
	} else {
		targets.push(m.t);
	}

	if (targets.length) {
		const relayBody: Record<string, unknown> = {
			type: 'edit',
			id: m.id,
			from: m.f,
			text: m.x,
			e: m.e,
			ts: m.d
		};
		if (m.gr) {
			relayBody.members = targets;
			relayBody.group = m.gr;
		} else {
			relayBody.to = targets[0];
		}
		await locals.x2_ws.fetch('https://x2-ws/relay', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(relayBody)
		}).catch(() => {});
	}

	return json({ ok: true, m });
};
