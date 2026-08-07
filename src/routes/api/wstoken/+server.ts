import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { dev } from '$app/environment';
import { get_secret, type SecretVal } from '$lib/server/qdrant';
import { get_key } from '$lib/server/session';
import { assert_session_current } from '$lib/server/hub_client';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) throw error(401, 'auth');
	await assert_session_current(env, locals.x2_ws, locals.user, locals.session_v ?? 0);
	const secret = await get_secret(env.SECRET);
	const exp = Date.now() + 300_000;
	const k = await get_key(secret);
	const raw = new TextEncoder().encode(`${locals.user.id}.${exp}`);
	const sig = await crypto.subtle.sign('HMAC', k, raw);
	const t = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
	const ws_origin = (env.WS_ORIGIN as string) || (dev ? 'ws://localhost:8787' : '');
	if (!ws_origin) throw error(503, 'ws_unconfigured');
	return json({ t, exp, uid: locals.user.id, ws: `${ws_origin}/ws` });
};
