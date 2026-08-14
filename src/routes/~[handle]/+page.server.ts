import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { get_group } from '$lib/server/group';
import { get_group_messages, get_user_names } from '$lib/server/chat';
import { is_muted } from '$lib/server/mute';

export const load: PageServerLoad = async ({ params, locals }) => {
	const g = await get_group(env, params.handle);
	if (!g) throw error(404, 'no group');
	const messages = locals.user ? await get_group_messages(env, params.handle) : [];
	const ids = [...new Set([...messages.map((m) => m.f), ...g.members])];
	const names = await get_user_names(env, ids);
	const muted = locals.user
		? await is_muted(env, locals.x2_ws, locals.user.id, params.handle)
		: false;
	return { g, messages, names, muted };
};
