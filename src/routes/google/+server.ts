import { error, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { Google, generateState, generateCodeVerifier } from 'arctic';
import { get_secret } from '$lib/server/qdrant';
import { save_user, get_user, patch_user, find_user_by_google_sub } from '$lib/server/user';
import { sign_in } from '$lib/server/signin';
import { uuid_from } from '$lib/server/qdrant';
import { attribute_referral, ensure_partner_code } from '$lib/server/partner';
import { clear_pin } from '$lib/server/pin_state';

const google_client = async (origin: string) =>
	new Google(
		await get_secret(env.GOOGLE_ID),
		await get_secret(env.GOOGLE_SECRET),
		new URL('/google', origin).toString()
	);

export const GET: RequestHandler = async ({ url, cookies, locals }) => {
	// forgot the pin: run the full google login again and drop the pin if it comes back as
	// the same account. A signed-in user normally bounces straight to /find, so both legs of
	// the reset have to be let through before that.
	const reset = url.searchParams.get('reset') === 'pin' || cookies.get('pin_reset') === '1';
	if (locals.user && !locals.user.is_device && !reset) throw redirect(302, '/find');

	const code = url.searchParams.get('code');
	const state = url.searchParams.get('state');

	// callback leg: google redirected back here with a code
	if (code) {
		const stored_state = cookies.get('oauth_state') ?? null;
		const stored_verifier = cookies.get('oauth_verifier') ?? null;
		if (!state || !stored_state || !stored_verifier || state !== stored_state)
			throw error(400, 'bad_oauth');
		const g = await google_client(url.origin);
		let tokens: { accessToken(): string };
		try {
			tokens = await g.validateAuthorizationCode(code, stored_verifier);
		} catch {
			throw error(400, 'oauth_failed');
		}
		const ures = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
			headers: { Authorization: `Bearer ${tokens.accessToken()}` }
		});
		if (!ures.ok) throw error(400, 'userinfo_failed');
		const gu = (await ures.json()) as { sub: string; picture?: string; email?: string };
		if (!gu.email) throw error(400, 'email_required');

		if (reset) {
			cookies.delete('pin_reset', { path: '/' });
			cookies.delete('oauth_state', { path: '/' });
			cookies.delete('oauth_verifier', { path: '/' });
			const me = locals.user ? await get_user(env, locals.user.id) : null;
			// the account that just proved itself has to be the account being unlocked, or a
			// second google account would be a way in
			if (!me || !locals.user || (me.g !== gu.sub && me.gl !== gu.sub && me.m !== gu.email))
				throw error(403, 'wrong_account');
			await clear_pin(env, locals.x2_ws, cookies, locals.user);
			throw redirect(302, '/profile#pin');
		}

		let id: string;
		let username: string;
		if (locals.user?.is_device) {
			const updated = await patch_user(env, locals.user.id, {
				gl: gu.sub,
				p: gu.picture,
				m: gu.email,
				o: 'google'
			});
			if (!updated) throw error(404, 'account not found');
			id = locals.user.id;
			username = updated.u;
		} else {
			const linked = await find_user_by_google_sub(env, gu.sub);
			const id_preview = linked ? linked.id : await uuid_from(gu.sub);
			const existed = linked ? true : !!(await get_user(env, id_preview));
			id = linked ? linked.id : await save_user(env, gu.sub, gu.picture, gu.email, 'google');
			username = linked ? linked.u : gu.email.split('@')[0].toLowerCase();

			const ref = (cookies.get('ref_code') ?? '').trim();
			if (!existed && ref) await attribute_referral(env, id, ref);
			await ensure_partner_code(env, id);
			cookies.delete('ref_code', { path: '/' });
		}

		await sign_in(env, locals.x2_ws, cookies, id, {
			username,
			picture: gu.picture,
			email: gu.email
		});
		cookies.delete('oauth_state', { path: '/' });
		cookies.delete('oauth_verifier', { path: '/' });
		throw redirect(302, '/find');
	}

	// start leg: optional ?c= from client, else keep existing ref cookie
	const start_ref = (url.searchParams.get('c') ?? '').trim();
	if (start_ref) {
		cookies.set('ref_code', start_ref.toLowerCase(), {
			path: '/',
			httpOnly: true,
			maxAge: 60 * 60 * 24 * 14,
			sameSite: 'lax'
		});
	}

	const s = generateState();
	const verifier = generateCodeVerifier();
	const g = await google_client(url.origin);
	const auth_url = g.createAuthorizationURL(s, verifier, ['openid', 'profile', 'email']);
	if (reset) {
		// Whoever is holding the phone is already signed in to google on it, so the plain
		// consent screen would wave them straight through and the pin would be worth nothing.
		// `prompt=login` plus `max_age=0` makes google ask for the password again.
		auth_url.searchParams.set('prompt', 'login');
		auth_url.searchParams.set('max_age', '0');
		cookies.set('pin_reset', '1', { path: '/', httpOnly: true, maxAge: 600, sameSite: 'lax' });
	}
	cookies.set('oauth_state', s, { path: '/', httpOnly: true, maxAge: 600, sameSite: 'lax' });
	cookies.set('oauth_verifier', verifier, {
		path: '/',
		httpOnly: true,
		maxAge: 600,
		sameSite: 'lax'
	});
	throw redirect(302, auth_url.toString());
};
