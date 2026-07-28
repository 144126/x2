import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { dev } from '$app/environment';
import { get_secret } from '$lib/server/qdrant';

// Issues a ws-token the client uses to open <WS_ORIGIN>/ws?uid=&t=
// Token = SHA-256(`${uid}.${SECRET}`), verified by the ws worker.
// WS_ORIGIN points at the deployed x2-ws worker (its real workers.dev subdomain or
// custom domain); falls back to a local `wrangler dev -c ws/wrangler.jsonc --port 8787`.
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) throw error(401, 'auth');
	const raw = new TextEncoder().encode(`${locals.user.id}.${await get_secret(env.SECRET)}`);
	const sig = await crypto.subtle.digest('SHA-256', raw);
	const t = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
	// Deployed with WS_ORIGIN unset we used to hand every client ws://localhost:8787 —
	// realtime silently never worked. Fail loudly instead; only dev gets the fallback.
	const ws_origin = (await get_secret(env.WS_ORIGIN)) || (dev ? 'ws://localhost:8787' : '');
	if (!ws_origin) throw error(503, 'ws_unconfigured');
	const qs = `uid=${encodeURIComponent(locals.user.id)}&t=${t}`;
	return json({ t, ws: `${ws_origin}/ws?${qs}`, match: `${ws_origin}/match?${qs}` });
};
