import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { get_group } from '$lib/server/group';
import { get_group_messages, get_user_name } from '$lib/server/chat';

export const load: PageServerLoad = async ({ params, locals }) => {
	if (!locals.user) throw error(401, 'auth');
	const g = await get_group(env, params.id);
	if (!g) throw error(404, 'no group');
	const messages = await get_group_messages(env, params.id);

	// one lookup per distinct sender, so bubbles show usernames rather than uuids
	const ids = [...new Set(messages.map((m) => m.f))];
	const names = Object.fromEntries(
		await Promise.all(ids.map(async (id) => [id, await get_user_name(env, id)] as const))
	);
	return { g, messages, names };
};
