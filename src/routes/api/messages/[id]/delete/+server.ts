import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { delete_msg } from '$lib/server/chat';
import { get_group } from '$lib/server/group';

export const POST: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) throw error(401, 'auth');
	const { id } = params;

	const result = await delete_msg(env, locals.user.id, id);

	const targets: string[] = [];
	if (result.gr) {
		const g = await get_group(env, result.gr);
		if (g) targets.push(...g.members.filter((u) => u !== result.f));
	} else if (result.t) {
		targets.push(result.t);
	}

	if (targets.length) {
		const relayBody: Record<string, unknown> = {
			type: 'delete',
			id
		};
		if (result.gr) {
			relayBody.members = targets;
			relayBody.group = result.gr;
		} else {
			relayBody.to = targets[0];
		}
		await locals.x2_ws
			.fetch('https://x2-ws/relay', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(relayBody)
			})
			.catch(() => {});
	}

	return json({ ok: true });
};
