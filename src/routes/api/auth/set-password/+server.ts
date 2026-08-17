import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { find_user_by_email, patch_user } from '$lib/server/user';
import { hash_pw } from '$lib/server/pw';
import { sign_in } from '$lib/server/signin';
import { assert_session_current } from '$lib/server/hub_client';

export const POST: RequestHandler = async ({ request, locals, cookies }) => {
	if (!locals.user) throw error(401, 'auth');
	await assert_session_current(env, locals.x2_ws, locals.user, locals.session_v ?? 0);
	const body = (await request.json().catch(() => null)) as { email?: string; password?: string };
	const email = body?.email?.trim().toLowerCase();
	const password = body?.password ?? '';
	if (!email || password.length < 6) throw error(400, 'email + password(>=6) required');

	const by_index = await find_user_by_email(env, email);
	if (by_index && by_index.id !== locals.user.id) throw error(409, 'email already in use');

	const updated = await patch_user(env, locals.user.id, {
		m: email,
		h: await hash_pw(password),
		o: 'local'
	});
	if (!updated) throw error(404, 'account not found');

	await sign_in(env, locals.x2_ws, cookies, locals.user.id, { username: updated.u, email });
	return json({ ok: true });
};
