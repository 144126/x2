import { redirect, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { get_user } from '$lib/server/user';

// a profile lives at /@username, but plenty of places only hold the uid — room member lists,
// already-delivered push notifications, and links made before profiles moved here
export const GET: RequestHandler = async ({ params }) => {
	const u = await get_user(env, params.id);
	if (!u?.u) throw error(404, 'not found');
	throw redirect(308, `/@${u.u}`);
};
