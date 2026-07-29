import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { list_conversations } from '$lib/server/chat';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) throw error(401, 'auth');
	const r = await list_conversations(env, locals.user.id);
	return json({ r });
};
