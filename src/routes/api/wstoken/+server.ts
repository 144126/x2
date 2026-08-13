import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { dev } from '$app/environment';
import { get_secret, type SecretVal } from '$lib/server/qdrant';
import { get_key } from '$lib/server/session';
import { assert_session_current } from '$lib/server/hub_client';
import { ensure_device_session } from '$lib/server/device';

async function mint(uid: string) {
	const secret = await get_secret(env.SECRET);
	const exp = Date.now() + 300_000;
	const k = await get_key(secret);
	const raw = new TextEncoder().encode(`${uid}.${exp}`);
	const sig = await crypto.subtle.sign('HMAC', k, raw);
	const t = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
	const ws_origin = (env.WS_ORIGIN as string) || (dev ? 'ws://localhost:8787' : '');
	if (!ws_origin) throw error(503, 'ws_unconfigured');
	const q = `uid=${encodeURIComponent(uid)}&t=${t}&exp=${exp}`;
	return { t, exp, uid, ws: `${ws_origin}/ws`, match: `${ws_origin}/match?${q}` };
}

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) throw error(401, 'auth');
	await assert_session_current(env, locals.x2_ws, locals.user, locals.session_v ?? 0);
	return json(await mint(locals.user.id));
};

// The random voice match is the first thing a brand-new visitor sees, so it mints a device
// account rather than sending them to a login wall — the same implicit session the room-join
// flow already creates. Signing in later links it.
export const POST: RequestHandler = async ({ locals, platform, cookies, getClientAddress }) => {
	const user = await ensure_device_session(env, platform, locals, cookies, getClientAddress);
	if (!user) throw error(401, 'auth');
	return json(await mint(user.id));
};
