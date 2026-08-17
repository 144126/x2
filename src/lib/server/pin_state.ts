import { error, type Cookies } from '@sveltejs/kit';
import { get_user, patch_user, can_lock, type User } from './user';
import { hub_sv_get, hub_sv_set } from './hub_client';
import { encode_session } from './session';
import { encode_unlock, hash_pin, set_unlock, clear_unlock } from './pin';
import type { QEnv } from './qdrant';

type Actor = { id: string; username: string; picture?: string; email?: string };

/**
 * Every change to the pin runs through here so the four things that must move together
 * always do: the stored hash, the pin version, this browser's session, and every other
 * browser's session. Bumping the hub's session version is what makes "set a pin" also mean
 * "the phone I left at the office is signed out now", instead of waiting seven days for its
 * cookie to age out.
 */
async function apply_pin(
	env: QEnv,
	ws: Fetcher,
	cookies: Cookies,
	actor: Actor,
	hash: string | undefined
): Promise<number> {
	const u = await get_user(env, actor.id);
	if (!u) throw error(404, 'no_account');
	const pv = (u.pv ?? 0) + 1;
	await patch_user(env, actor.id, { pn: hash, pv, pf: 0, pl: 0 });

	const sv = (await hub_sv_get(env, ws, actor.id)) + 1;
	await hub_sv_set(env, ws, actor.id, sv);

	cookies.set(
		'session',
		await encode_session(env.SECRET, {
			id: actor.id,
			username: u.u ?? actor.username,
			picture: u.p ?? actor.picture,
			email: u.m ?? actor.email,
			v: sv,
			pin: hash ? pv : 0
		}),
		{ path: '/', httpOnly: true, maxAge: 604800, sameSite: 'lax' }
	);

	// the browser making the change stays unlocked — being thrown at the lock screen the
	// instant you choose a pin is the fastest way to be sure you mistyped it
	if (hash) set_unlock(cookies, await encode_unlock(env.SECRET, actor.id, pv));
	else clear_unlock(cookies);
	return pv;
}

export async function set_pin(
	env: QEnv,
	ws: Fetcher,
	cookies: Cookies,
	actor: Actor,
	pin: string
): Promise<number> {
	return apply_pin(env, ws, cookies, actor, await hash_pin(env.SECRET, actor.id, pin));
}

export async function clear_pin(
	env: QEnv,
	ws: Fetcher,
	cookies: Cookies,
	actor: Actor
): Promise<number> {
	return apply_pin(env, ws, cookies, actor, undefined);
}

/** Loads the user and refuses the request unless a pin is allowed on this account at all. */
export async function lockable(env: QEnv, uid: string): Promise<User> {
	const u = await get_user(env, uid);
	if (!u) throw error(404, 'no_account');
	if (!can_lock(u)) throw error(409, 'needs_login');
	return u;
}
