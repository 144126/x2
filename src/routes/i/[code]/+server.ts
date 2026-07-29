import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/** Short invite URL → login with the partner code preserved as `?c=`. */
export const GET: RequestHandler = async ({ params }) => {
	const code = (params.code ?? '').trim().toLowerCase();
	if (!code) throw redirect(302, '/login');
	throw redirect(302, `/login?c=${encodeURIComponent(code)}`);
};
