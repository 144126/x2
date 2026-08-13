import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { get_message } from '$lib/server/chat';
import { is_member } from '$lib/server/group';

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) throw error(401, 'auth');
	const m = await get_message(env, params.id);
	if (!m) throw error(404, 'not found');
	const uid = locals.user.id;
	const allowed = m.gr ? await is_member(env, locals.x2_ws, m.gr, uid) : m.f === uid || m.t === uid;
	if (!allowed) throw error(403, 'not a participant');
	return json({ m });
};
