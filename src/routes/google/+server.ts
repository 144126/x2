import { error, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { Google, generateState, generateCodeVerifier } from 'arctic';
import { get_secret } from '$lib/server/qdrant';
import { save_user } from '$lib/server/user';
import { encode_session } from '$lib/server/session';

const google_client = async (origin: string) =>
	new Google(
		await get_secret(env.GOOGLE_ID),
		await get_secret(env.GOOGLE_SECRET),
		new URL('/google', origin).toString()
	);

export const GET: RequestHandler = async ({ url, cookies, locals }) => {
	if (locals.user) throw redirect(302, '/app');

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
		const gu = (await ures.json()) as { sub: string; name: string; picture?: string; email?: string };
		const id = await save_user(
			env,
			gu.sub,
			gu.name,
			gu.picture,
			gu.email,
			'google'
		);
		const session = await encode_session(env.SECRET, {
			id,
			name: gu.name,
			picture: gu.picture,
			email: gu.email
		});
		cookies.set('session', session, { path: '/', httpOnly: true, maxAge: 604800, sameSite: 'lax' });
		cookies.delete('oauth_state', { path: '/' });
		cookies.delete('oauth_verifier', { path: '/' });
		throw redirect(302, '/app');
	}

	// start leg: kick off the google auth flow
	const s = generateState();
	const verifier = generateCodeVerifier();
	const g = await google_client(url.origin);
	const auth_url = g.createAuthorizationURL(s, verifier, ['openid', 'profile', 'email']);
	cookies.set('oauth_state', s, { path: '/', httpOnly: true, maxAge: 600, sameSite: 'lax' });
	cookies.set('oauth_verifier', verifier, { path: '/', httpOnly: true, maxAge: 600, sameSite: 'lax' });
	throw redirect(302, auth_url.toString());
};
