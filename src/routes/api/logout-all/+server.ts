import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { hub_sv_get, hub_sv_set, assert_session_current } from '$lib/server/hub_client';

export const POST: RequestHandler = async ({ locals, platform, cookies }) => {
	if (!locals.user) throw error(401, 'auth');
	const x2_ws = platform?.env?.X2_WS as Fetcher | undefined;
	if (!x2_ws) throw error(503, 'ws_unconfigured');
	await assert_session_current(env, x2_ws, locals.user, locals.session_v ?? 0);
	const sv = await hub_sv_get(env, x2_ws, locals.user.id);
	await hub_sv_set(env, x2_ws, locals.user.id, sv + 1);
	cookies.delete('session', { path: '/' });
	return json({ ok: true });
};
