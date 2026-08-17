import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { create_pw_user, get_user, find_user_by_email } from '$lib/server/user';
import { uuid_from } from '$lib/server/qdrant';
import { attribute_referral, ensure_partner_code } from '$lib/server/partner';
import { sign_in } from '$lib/server/signin';

export const POST: RequestHandler = async ({ request, cookies, locals }) => {
	const body = (await request.json().catch(() => null)) as { e?: string; p?: string; c?: string };
	const e = body?.e?.trim().toLowerCase();
	const p = body?.p ?? '';
	if (!e || !p || p.length < 6) throw error(400, 'email + password(>=6) required');

	const id = await uuid_from(e);
	const linked_elsewhere = await find_user_by_email(env, e);
	if (linked_elsewhere && linked_elsewhere.id !== id) {
		throw error(409, 'email already in use — log in instead');
	}
	const existed = !!(await get_user(env, id));
	await create_pw_user(env, e, p);

	// Only attribute brand-new accounts (re-register of an existing email is not a new signup).
	const code = (body?.c ?? cookies.get('ref_code') ?? '').trim();
	if (!existed && code) await attribute_referral(env, id, code);
	await ensure_partner_code(env, id);

	cookies.delete('ref_code', { path: '/' });
	// re-registering an email that already exists keeps whatever that account had, pin included
	await sign_in(env, locals.x2_ws, cookies, id, { username: e.split('@')[0], email: e });
	return json({ ok: true });
};
