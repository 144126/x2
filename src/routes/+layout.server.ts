import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, url }) => {
	const open =
		url.pathname === '/' ||
		url.pathname === '/login' ||
		url.pathname === '/app/rooms' ||
		url.pathname.startsWith('/app/rooms/');
	if (!locals.user && !open) throw redirect(302, '/login');
	if (locals.user && url.pathname === '/login') throw redirect(302, '/app');
	if (locals.user && url.pathname === '/') throw redirect(302, '/app/rooms');
	return { user: locals.user };
};
