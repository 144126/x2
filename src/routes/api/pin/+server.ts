import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { assert_session_current } from '$lib/server/hub_client';
import { valid_pin, verify_pin, MIN, MAX } from '$lib/server/pin';
import { set_pin, clear_pin, lockable } from '$lib/server/pin_state';
import { guard } from '$lib/server/rl';

/** set a pin, or change an existing one */
export const POST: RequestHandler = async ({ request, locals, cookies, platform }) => {
	if (!locals.user) throw error(401, 'auth');
	await assert_session_current(env, locals.x2_ws, locals.user, locals.session_v ?? 0);
	await guard(platform, 'RL_PIN', locals.user.id);

	const body = (await request.json().catch(() => null)) as { pin?: string; current?: string };
	const pin = body?.pin ?? '';
	if (!valid_pin(pin)) throw error(400, `pin must be ${MIN}-${MAX} digits`);

	const u = await lockable(env, locals.user.id);
	// changing a pin needs the old one, so a browser someone walked up to mid-session cannot
	// quietly swap it for one they know
	if (u.pn && !(await verify_pin(env.SECRET, locals.user.id, body?.current ?? '', u.pn)))
		throw error(403, 'wrong_pin');

	await set_pin(env, locals.x2_ws, cookies, locals.user, pin);
	return json({ ok: true });
};

/** turn the lock off */
export const DELETE: RequestHandler = async ({ request, locals, cookies, platform }) => {
	if (!locals.user) throw error(401, 'auth');
	await assert_session_current(env, locals.x2_ws, locals.user, locals.session_v ?? 0);
	await guard(platform, 'RL_PIN', locals.user.id);

	const body = (await request.json().catch(() => null)) as { current?: string };
	const u = await lockable(env, locals.user.id);
	if (!u.pn) return json({ ok: true });
	if (!(await verify_pin(env.SECRET, locals.user.id, body?.current ?? '', u.pn)))
		throw error(403, 'wrong_pin');

	await clear_pin(env, locals.x2_ws, cookies, locals.user);
	return json({ ok: true });
};
