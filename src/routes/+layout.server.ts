import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, url }) => {
	// the homepage is the random voice match, so it stays open to everyone, signed in or not
	const open = url.pathname === '/' || url.pathname === '/login';
	if (!locals.user && !open) throw redirect(302, '/login');
	if (locals.user && url.pathname === '/login') throw redirect(302, '/app');
	return { user: locals.user };
};
