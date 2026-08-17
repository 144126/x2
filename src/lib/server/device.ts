import type { QEnv, SecretVal } from './qdrant';
import { uuid_from } from './qdrant';
import { get_user, save_user, is_device_only, type User } from './user';
import { encode_session } from './session';
import { guard } from './rl';
import type { Cookies } from '@sveltejs/kit';

export async function get_or_create_device_user(
	env: QEnv,
	device_id: string
): Promise<User & { id: string }> {
	const id = await uuid_from(device_id);
	const existing = await get_user(env, id);
	if (existing) return { ...existing, id };
	await save_user(env, device_id, undefined, undefined, 'device');
	return { ...(await get_user(env, id))!, id };
}

// Called at the top of the small set of write routes a brand-new, never-logged-in visitor can
// reach (send a message, create/join a room). Everywhere else in the app already requires a
// real session (reached only via the room-join flow this establishes, or a real login) — this
// is the single place a session gets minted with no credential behind it, so it's also the one
// place a rate limit keyed on something other than a uid belongs (see RL_DEVICE_CREATE below;
// every other limiter in this codebase is deliberately uid-only, per the comment in
// wrangler.jsonc — this is a narrow, justified exception because no uid exists yet).
export async function ensure_device_session(
	env: QEnv & { SECRET?: SecretVal },
	platform: App.Platform | undefined,
	locals: App.Locals,
	cookies: Cookies,
	get_client_address: () => string
): Promise<{ id: string; username: string } | null> {
	if (locals.user) return locals.user;
	const device_id = locals.device_id;
	if (!device_id) return null;
	await guard(platform, 'RL_DEVICE_CREATE', get_client_address());
	const u = await get_or_create_device_user(env, device_id);
	const session = await encode_session(env.SECRET, {
		id: u.id,
		username: u.u,
		is_device: is_device_only(u),
		// this device id may belong to an account that has since linked google and set a pin —
		// a cleared cookie must not hand back a session that has never heard of it
		pin: u.pn ? (u.pv ?? 0) : 0
	});
	cookies.set('session', session, { path: '/', httpOnly: true, maxAge: 604800, sameSite: 'lax' });
	locals.user = { id: u.id, username: u.u };
	return locals.user;
}
