import { search_groups } from '$lib/server/group';
import { env } from '$env/dynamic/private';
import type { PageServerLoad } from './$types';

// the homepage is the voice match; rooms are the fallback for when nobody is around
export const load: PageServerLoad = async () => {
	const rooms = await search_groups(env, '', undefined, 4);
	return { rooms };
};
