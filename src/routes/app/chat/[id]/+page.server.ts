import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { get_messages, get_user_name } from '$lib/server/chat';
import { ensure } from '$lib/server/qdrant';

export const load: PageServerLoad = async ({ params, locals }) => {
	if (!locals.user) throw error(401, 'auth');
	await ensure(env);
	const peer = params.id;
	const [msgs, name] = await Promise.all([
		get_messages(env, locals.user.id, peer),
		get_user_name(env, peer)
	]);
	return { peer, peer_name: name, messages: msgs };
};
