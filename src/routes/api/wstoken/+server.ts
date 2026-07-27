import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
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
	const ws_origin = (await get_secret(env.WS_ORIGIN)) || 'ws://localhost:8787';
	const qs = `uid=${encodeURIComponent(locals.user.id)}&t=${t}`;
	return json({ t, ws: `${ws_origin}/ws?${qs}`, match: `${ws_origin}/match?${qs}` });
};
