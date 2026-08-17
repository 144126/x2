import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

// pin_on stays optional so every page's data type keeps the shape it had before the lock
// existed — an absent flag means the same thing as false everywhere it is read
type Data = { user: App.Locals['user']; pin_on?: boolean };

export const load: LayoutServerLoad = async ({ locals, url }): Promise<Data> => {
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
	// A locked browser gets the shell of a signed-out visitor: no nav, no username, no avatar.
	// The lock screen is the only page it can reach, and it must give away nothing about the
	// account behind it beyond the one thing it has to ask for.
	return {
		user: locals.pin_locked ? null : locals.user,
		...(locals.pin_on ? { pin_on: true } : {})
	};
};
