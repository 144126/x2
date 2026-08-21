import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	// people search is readable signed out
	return {};
};
