import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { create_pw_user } from '$lib/server/user';

import { encode_session } from '$lib/server/session';

export const POST: RequestHandler = async ({ request, cookies }) => {
	const body = (await request.json().catch(() => null)) as { e?: string; p?: string };
	const e = body?.e?.trim().toLowerCase();
	const p = body?.p ?? '';
	if (!e || !p || p.length < 6) throw error(400, 'email + password(>=6) required');
	const id = await create_pw_user(env, e, p);
	const session = await encode_session(env.SECRET, { id, username: e.split('@')[0], email: e });
	cookies.set('session', session, { path: '/', httpOnly: true, maxAge: 604800, sameSite: 'lax' });
	return json({ ok: true });
};
