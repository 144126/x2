import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import {
	delete_msg,
	delete_msg_for_me,
	get_message_raw,
	may_read,
	may_delete_for_all
} from '$lib/server/chat';
import { audience, relay_to } from '$lib/server/msg_relay';

/**
 * Two different acts share this route because they answer the same question — "make this go
 * away" — and differ only in whose copy. `me` hides it for one reader and touches nobody
 * else's thread. `all` destroys the content everywhere, leaving a tombstone.
 */
export const POST: RequestHandler = async ({ params, request, locals, platform }) => {
	if (!locals.user) throw error(401, 'auth');
	const uid = locals.user.id;
	const scope = ((await request.json().catch(() => null)) as { scope?: string })?.scope ?? 'all';

	const m = await get_message_raw(env, params.id);
	if (!m) throw error(404, 'not found');
	if (!(await may_read(env, locals.x2_ws, m, uid))) throw error(403, 'not a participant');

	if (scope === 'me') {
		await delete_msg_for_me(env, uid, m);
		return json({ ok: true, scope: 'me' });
	}

	if (!(await may_delete_for_all(env, uid, m))) throw error(403, 'not author');
	await delete_msg(env, platform?.env?.MEDIA, uid, params.id);
	locals.bg(
		audience(env, m, uid).then((t) => relay_to(locals.x2_ws, t, { type: 'delete', id: params.id }))
	);
	return json({ ok: true, scope: 'all' });
};
