import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { create_pw_user, get_user } from '$lib/server/user';
import { uuid_from } from '$lib/server/qdrant';
import { attribute_referral, ensure_partner_code } from '$lib/server/partner';
import { encode_session } from '$lib/server/session';

export const POST: RequestHandler = async ({ request, cookies }) => {
	const body = (await request.json().catch(() => null)) as { e?: string; p?: string; c?: string };
	const e = body?.e?.trim().toLowerCase();
	const p = body?.p ?? '';
	if (!e || !p || p.length < 6) throw error(400, 'email + password(>=6) required');

	const id = await uuid_from(e);
	const existed = !!(await get_user(env, id));
	await create_pw_user(env, e, p);

	// Only attribute brand-new accounts (re-register of an existing email is not a new signup).
	const code = (body?.c ?? cookies.get('ref_code') ?? '').trim();
	if (!existed && code) await attribute_referral(env, id, code);
	await ensure_partner_code(env, id);

	cookies.delete('ref_code', { path: '/' });
	const session = await encode_session(env.SECRET, { id, username: e.split('@')[0], email: e });
	cookies.set('session', session, { path: '/', httpOnly: true, maxAge: 604800, sameSite: 'lax' });
	return json({ ok: true });
};
