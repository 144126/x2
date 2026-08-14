import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { list_groups } from '$lib/server/group';
import { list_folders } from '$lib/server/folders';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) throw error(401, 'auth');
	const [mine, folders] = await Promise.all([
		list_groups(env, locals.user.id),
		list_folders(env, locals.user.id, 'r')
	]);
	return { mine, folders };
};
