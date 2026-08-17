import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { get_user, patch_user } from '$lib/server/user';
import { verify_pw } from '$lib/server/pw';
import { clear_pin } from '$lib/server/pin_state';
import { lockout_ms } from '$lib/server/pin';
import { guard } from '$lib/server/rl';

/**
 * Forgot the pin: prove the account itself instead. This is the password half — the google
 * half lives in `/google?reset=pin`, which forces a fresh google login rather than riding an
 * existing one. Either way the pin only comes off for someone who can sign in from scratch.
 */
export const POST: RequestHandler = async ({ request, locals, cookies, platform }) => {
	if (!locals.user) throw error(401, 'auth');
	await guard(platform, 'RL_PIN', locals.user.id);

	const u = await get_user(env, locals.user.id);
	if (!u) throw error(404, 'no_account');
	if (!u.h) throw error(409, 'no_password');

	const now = Date.now();
	if (u.pl && u.pl > now) return json({ ok: false, wait: u.pl - now }, { status: 429 });

	const pw = ((await request.json().catch(() => null)) as { password?: string })?.password ?? '';
	if (!pw || !(await verify_pw(pw, u.h))) {
		// a guessed password is a guessed way past the pin, so it feeds the same counter
		const fails = (u.pf ?? 0) + 1;
		const wait = lockout_ms(fails);
		await patch_user(env, locals.user.id, { pf: fails, pl: wait ? now + wait : 0 });
		return json({ ok: false, wait }, { status: 403 });
	}

	await clear_pin(env, locals.x2_ws, cookies, locals.user);
	return json({ ok: true });
};
