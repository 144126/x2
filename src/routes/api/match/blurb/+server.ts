import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { conv_id } from '$lib/server/chat';
import { get_user } from '$lib/server/user';
import { match_blurb } from '$lib/server/blurb';
import { guard } from '$lib/server/rl';

export const GET: RequestHandler = async ({ url, locals, platform }) => {
	if (!locals.user) throw error(401, 'auth');
	const peer = url.searchParams.get('peer')?.trim();
	if (!peer) throw error(400, 'peer required');
	await guard(platform, 'RL_AI', locals.user.id);

	const [a, b] = await Promise.all([get_user(env, locals.user.id), get_user(env, peer)]);
	if (!a || !b) throw error(404, 'no user');

	return json({ t: await match_blurb(env, conv_id(locals.user.id, peer), a, b) });
};
