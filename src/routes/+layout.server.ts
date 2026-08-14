import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, url }) => {
	// watching is free; talking is what needs an account. Rooms, profiles and both searches
	// are readable signed out, so a link shared with a stranger always lands somewhere real
	const open =
		['/', '/login', '/rooms', '/find'].includes(url.pathname) ||
		url.pathname.startsWith('/~') ||
		url.pathname.startsWith('/@') ||
		// the 308 shims for the old room urls, which a stranger may still be holding
		url.pathname.startsWith('/rooms/') ||
		url.pathname.startsWith('/groups/');
	if (!locals.user && !open) throw redirect(302, '/login');
	if (locals.user && url.pathname === '/login') throw redirect(302, '/find');
	return { user: locals.user };
};
