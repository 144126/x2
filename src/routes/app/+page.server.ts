import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { list_conversations, get_user_name } from '$lib/server/chat';
import { ensure } from '$lib/server/qdrant';
import { list_folders } from '$lib/server/folders';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) throw error(401, 'auth');
	await ensure(env);
	const [convs, folders] = await Promise.all([
		list_conversations(env, locals.user.id),
		list_folders(env, locals.user.id)
	]);
	const r = await Promise.all(
		convs.map(async (c) => ({ ...c, name: await get_user_name(env, c.peer) }))
	);
	return { convs: r, folders };
};
