import { search_groups } from '$lib/server/group';
import { env } from '$env/dynamic/private';
import type { PageServerLoad } from './$types';

// the homepage is the voice match; the search under it is the way in for anyone who would
// rather pick than be picked. Rooms render on the server so the results are in the HTML,
// which is what a crawler and a signed-out visitor both get.
export const load: PageServerLoad = async ({ url }) => {
	const q = url.searchParams.get('q')?.trim() ?? '';
	return { q, rooms: await search_groups(env, q, undefined, q ? 8 : 4) };
};
