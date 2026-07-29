import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { verify_user_pw } from '$lib/server/user';
import { uuid_from } from '$lib/server/qdrant';

import { encode_session } from '$lib/server/session';

export const POST: RequestHandler = async ({ request, cookies, locals }) => {
	if (locals.user) return json({ ok: true });
	const body = (await request.json().catch(() => null)) as { e?: string; p?: string };
	const e = body?.e?.trim().toLowerCase();
	const p = body?.p ?? '';
	if (!e || !p) throw error(400, 'email and password required');
	const u = await verify_user_pw(env, e, p);
	if (!u) throw error(401, 'invalid credentials');
	const session = await encode_session(env.SECRET, {
		id: await uuid_from(e),
		username: u.u,
		picture: u.p,
		email: u.m
	});
	cookies.set('session', session, { path: '/', httpOnly: true, maxAge: 604800, sameSite: 'lax' });
	return json({ ok: true });
};
