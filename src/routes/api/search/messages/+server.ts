import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { search_messages } from '$lib/server/chat';

export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) throw error(401, 'auth');
	const q = (url.searchParams.get('q') ?? '').trim();
	if (!q) return json({ messages: [] });
	const conv = url.searchParams.get('conv') ?? undefined;
	const messages = await search_messages(env, locals.user.id, q, conv);
	return json({ messages });
};
