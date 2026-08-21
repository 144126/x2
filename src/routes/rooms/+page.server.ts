import type { PageServerLoad } from './$types';
import { env } from '$env/dynamic/private';
import { list_groups } from '$lib/server/group';
import { list_folders } from '$lib/server/folders';

export const load: PageServerLoad = async ({ locals }) => {
	const uid = locals.user?.id;
	// rooms are readable signed out — only the per-user lists are empty for a guest
	if (!uid) return { mine: [], folders: [] };
	const [mine, folders] = await Promise.all([list_groups(env, uid), list_folders(env, uid, 'r')]);
	return { mine, folders };
};
