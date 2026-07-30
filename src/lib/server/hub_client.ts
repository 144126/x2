// Thin client for the ws worker's per-user ChatHub Durable Object routes
// (`/hub/:uid/*`, see ws/src/index.ts). ChatHub owns unread counts, read markers, mutes
// and push subscriptions for its uid — see plan/scale.plan.json -> hub_owns_delivery.
import { get_secret, type QEnv } from './qdrant';

async function call(
	env: QEnv,
	ws: Fetcher,
	uid: string,
	path: string,
	init?: RequestInit
): Promise<Response> {
	const secret = await get_secret(env.SECRET);
	return ws.fetch(`https://x2-ws/hub/${uid}${path}`, {
		...init,
		headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` }
	});
}

export async function hub_convs(
	env: QEnv,
	ws: Fetcher,
	uid: string
): Promise<{ peer?: string; group?: string; last: number; preview: string; unread: number }[]> {
	const res = await call(env, ws, uid, '/convs').catch(() => null);
	if (!res?.ok) return [];
	return (await res.json()).convs;
}

export async function hub_conv(
	env: QEnv,
	ws: Fetcher,
	uid: string,
	conv: string,
	peer_or_group: { peer: string } | { group: string },
	last: number,
	preview: string
): Promise<void> {
	await call(env, ws, uid, '/conv', {
		method: 'POST',
		body: JSON.stringify({ conv, ...peer_or_group, last, preview })
	});
}

export async function hub_unread(
	env: QEnv,
	ws: Fetcher,
	uid: string
): Promise<{ total: number; by_conv: Record<string, number> }> {
	const res = await call(env, ws, uid, '/unread').catch(() => null);
	if (!res?.ok) return { total: 0, by_conv: {} };
	return res.json();
}

export async function hub_mark_read(
	env: QEnv,
	ws: Fetcher,
	uid: string,
	conv: string,
	ts?: number
): Promise<number> {
	const res = await call(env, ws, uid, '/read', {
		method: 'POST',
		body: JSON.stringify({ conv, ts })
	}).catch(() => null);
	if (!res?.ok) return 0;
	return (await res.json()).total;
}

export async function hub_mute(
	env: QEnv,
	ws: Fetcher,
	uid: string,
	target: string,
	kind: 'u' | 'r',
	until: number
): Promise<void> {
	await call(env, ws, uid, '/mute', {
		method: 'POST',
		body: JSON.stringify({ target, kind, until })
	});
}

export async function hub_unmute(env: QEnv, ws: Fetcher, uid: string, target: string): Promise<void> {
	await call(env, ws, uid, '/unmute', { method: 'POST', body: JSON.stringify({ target }) });
}

export async function hub_mutes(
	env: QEnv,
	ws: Fetcher,
	uid: string
): Promise<{ tg: string; k: 'u' | 'r'; until: number }[]> {
	const res = await call(env, ws, uid, '/mutes').catch(() => null);
	if (!res?.ok) return [];
	return (await res.json()).mutes;
}

export async function hub_sub(
	env: QEnv,
	ws: Fetcher,
	uid: string,
	sub: { endpoint: string; keys: { p256dh: string; auth: string } },
	ua?: string
): Promise<void> {
	await call(env, ws, uid, '/sub', {
		method: 'POST',
		body: JSON.stringify({ ep: sub.endpoint, k: sub.keys.p256dh, au: sub.keys.auth, ua })
	});
}

export async function hub_unsub(
	env: QEnv,
	ws: Fetcher,
	uid: string,
	endpoint: string
): Promise<void> {
	await call(env, ws, uid, '/unsub', { method: 'POST', body: JSON.stringify({ ep: endpoint }) });
}
