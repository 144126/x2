import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { get_messages, get_group_messages } from '$lib/server/chat';

export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) throw error(401, 'auth');
	const before = Number(url.searchParams.get('before')) || undefined;
	const group = url.searchParams.get('g');
	if (group) return json({ r: await get_group_messages(env, group, before) });
	const peer = url.searchParams.get('u');
	if (!peer) throw error(400, 'u or g required');
	return json({ r: await get_messages(env, locals.user.id, peer, before) });
};
