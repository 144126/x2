import type { Cookies } from '@sveltejs/kit';
import { get_user } from './user';
import { hub_sv_get } from './hub_client';
import { encode_session } from './session';
import type { QEnv } from './qdrant';

/**
 * The one way to hand out a session cookie after a credential check. Two things have to be
 * read from the account rather than assumed, and both were assumed before this existed:
 *
 * - the pin version, so a pin set on a phone is already in force the first time you sign in
 *   on a laptop, instead of the laptop getting a session that has never heard of it;
 * - the hub's session version, so signing in again after "sign out everywhere" is not itself
 *   read as the revoked session it just replaced.
 */
export async function sign_in(
	env: QEnv,
	ws: Fetcher,
	cookies: Cookies,
	id: string,
	fallback: { username: string; picture?: string; email?: string }
): Promise<void> {
	const u = await get_user(env, id);
	const session = await encode_session(env.SECRET, {
		id,
		username: u?.u ?? fallback.username,
		picture: u?.p ?? fallback.picture,
		email: u?.m ?? fallback.email,
		v: await hub_sv_get(env, ws, id),
		pin: u?.pn ? (u.pv ?? 0) : 0,
		is_device: false
	});
	cookies.set('session', session, { path: '/', httpOnly: true, maxAge: 604800, sameSite: 'lax' });
}
