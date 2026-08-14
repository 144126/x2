import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { ensure, upsert, uuid_from, new_id } from '$lib/server/qdrant';
import { guard } from '$lib/server/rl';

/**
 * A random voice call with a stranger is the one place in this app where someone can be
 * abused with no record left behind. A report writes that record. It is deliberately the
 * cheapest action in the call UI — never rate-limited into uselessness, never delayed.
 */
export const POST: RequestHandler = async ({ request, locals, platform }) => {
	if (!locals.user) throw error(401, 'auth');
	const b = (await request.json().catch(() => null)) as {
		peer?: string;
		conv?: string;
		reason?: string;
	} | null;
	const peer = b?.peer?.trim();
	if (!peer) throw error(400, 'peer required');
	await guard(platform, 'RL_SEND', locals.user.id);

	await ensure(env);
	await upsert(env, [
		{
			id: await uuid_from(`report:${new_id()}`),
			vector: {},
			payload: {
				s: 'rp',
				f: locals.user.id,
				t: peer,
				c: b?.conv ?? '',
				x: (b?.reason ?? '').slice(0, 500),
				d: Date.now()
			}
		}
	]);
	return json({ ok: true });
};
