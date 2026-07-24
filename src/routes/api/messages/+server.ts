import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { get_messages } from '$lib/server/chat';


export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) throw error(401, 'auth');
	const peer = url.searchParams.get('u');
	if (!peer) throw error(400, 'u required');
	const r = await get_messages(env, locals.user.id, peer);
	return json({ r });
};
