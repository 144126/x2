import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { get_user, patch_user } from '$lib/server/user';
import { assert_session_current } from '$lib/server/hub_client';
import {
	verify_pin,
	encode_unlock,
	set_unlock,
	lockout_ms,
	valid_pin,
	FREE_TRIES
} from '$lib/server/pin';
import { guard } from '$lib/server/rl';

export const POST: RequestHandler = async ({ request, locals, cookies, platform }) => {
	if (!locals.user) throw error(401, 'auth');
	await assert_session_current(env, locals.x2_ws, locals.user, locals.session_v ?? 0);
	// the burst limiter is the cheap outer wall; the counter on the user record below is the
	// one that matters, because it survives a new browser, a new device and a new colo
	await guard(platform, 'RL_PIN', locals.user.id);

	const u = await get_user(env, locals.user.id);
	if (!u?.pn) return json({ ok: true, off: true });
	if ((u.pv ?? 0) !== (locals.pin_v ?? 0)) throw error(401, 'revoked');

	const now = Date.now();
	if (u.pl && u.pl > now) return json({ ok: false, wait: u.pl - now }, { status: 429 });

	const pin = ((await request.json().catch(() => null)) as { pin?: string })?.pin ?? '';
	if (valid_pin(pin) && (await verify_pin(env.SECRET, locals.user.id, pin, u.pn))) {
		await patch_user(env, locals.user.id, { pf: 0, pl: 0 });
		set_unlock(cookies, await encode_unlock(env.SECRET, locals.user.id, u.pv ?? 0));
		return json({ ok: true });
	}

	const fails = (u.pf ?? 0) + 1;
	const wait = lockout_ms(fails);
	await patch_user(env, locals.user.id, { pf: fails, pl: wait ? now + wait : 0 });
	return json({ ok: false, wait, left: Math.max(0, FREE_TRIES - fails) }, { status: 403 });
};
