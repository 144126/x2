import { search_groups } from '$lib/server/group';
import { env } from '$env/dynamic/private';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const q = url.searchParams.get('q') ?? '';
	const rooms = await search_groups(env, q, undefined, 12);
	return { rooms };
};
