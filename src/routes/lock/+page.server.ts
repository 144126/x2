import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { env } from '$env/dynamic/private';
import { get_user } from '$lib/server/user';
import { FREE_TRIES } from '$lib/server/pin';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.user) throw redirect(302, '/login');
	if (!locals.pin_locked) throw redirect(302, back(url.searchParams.get('r')));

	const u = await get_user(env, locals.user.id);
	const wait = u?.pl && u.pl > Date.now() ? u.pl - Date.now() : 0;
	// nothing here names the account. A lock screen that greets you by username has already
	// told a stranger holding the phone who they stole it from.
	return {
		has_google: u?.o === 'google' || !!u?.gl,
		has_pw: !!u?.h,
		left: Math.max(0, FREE_TRIES - (u?.pf ?? 0)),
		wait,
		r: back(url.searchParams.get('r'))
	};
};

/** only ever bounce back inside this site, and never to the lock screen itself — `?r=` is
 * whatever was in the address bar */
function back(r: string | null): string {
	if (!r || !r.startsWith('/') || r.startsWith('//') || r.startsWith('/lock')) return '/';
	return r;
}
