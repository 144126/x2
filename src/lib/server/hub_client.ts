// Thin client for the ws worker's per-user ChatHub Durable Object routes
// (`/hub/:uid/*`, see ws/src/index.ts). ChatHub owns unread counts, read markers, mutes
// and push subscriptions for its uid — see plan/scale.plan.json -> hub_owns_delivery.
import { get_secret, type QEnv } from './qdrant';
import { error } from '@sveltejs/kit';

// Typed failure for hub reads so a dead/mismatched/older ws worker is distinguishable
// from "genuinely no conversations" — reason: 'network' | 'http_<status>' | 'bad_shape'.
export class ChatHubError extends Error {
	constructor(public reason: string) {
		super(reason);
	}
}

async function call(
	env: QEnv,
	ws: Fetcher,
	uid: string,
	path: string,
	init?: RequestInit
): Promise<Response> {
	// DEV_SECRET parity with ws/src/index.ts:54 — the ws worker validates against
	// DEV_SECRET when its local Secrets Store is empty (pnpm dev:full/dev:ws)
	const secret = await get_secret(env.SECRET, env.DEV_SECRET);
	const started = Date.now();
	const res = await ws.fetch(`https://x2-ws/hub/${uid}${path}`, {
		...init,
		headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` }
	});
	console.log(
		`[HUB] ${init?.method ?? 'GET'} /hub/${uid.slice(0, 8)}${path} -> ${res.status} ${Date.now() - started}ms`
	);
	return res;
}

export async function hub_convs(
	env: QEnv,
	ws: Fetcher,
	uid: string
): Promise<{ peer?: string; group?: string; last: number; preview: string; unread: number }[]> {
	// surface failures (throws ChatHubError) instead of returning [] — the caller must be
	// able to tell "hub unreachable" from "no conversations" (see chats +page.server.ts)
	const res = await call(env, ws, uid, '/convs').catch(() => null);
	if (!res) throw new ChatHubError('network');
	if (!res.ok) throw new ChatHubError(`http_${res.status}`);
	const body = (await res.json().catch(() => null)) as { convs?: unknown } | null;
	if (!body || !Array.isArray(body.convs)) throw new ChatHubError('bad_shape');
	return body.convs as {
		peer?: string;
		group?: string;
		last: number;
		preview: string;
		unread: number;
	}[];
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

export async function hub_unmute(
	env: QEnv,
	ws: Fetcher,
	uid: string,
	target: string
): Promise<void> {
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

async function room_call(
	env: QEnv,
	ws: Fetcher,
	id: string,
	path: string,
	init?: RequestInit
): Promise<Response> {
	const secret = await get_secret(env.SECRET);
	return ws.fetch(`https://x2-ws/room/${id}${path}`, {
		...init,
		headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` }
	});
}

export async function room_join(
	env: QEnv,
	ws: Fetcher,
	id: string,
	uid: string
): Promise<string[]> {
	const res = await room_call(env, ws, id, '/join', {
		method: 'POST',
		body: JSON.stringify({ uid })
	}).catch(() => null);
	if (!res?.ok) return [];
	return (await res.json()).members;
}

export async function room_leave(
	env: QEnv,
	ws: Fetcher,
	id: string,
	uid: string
): Promise<string[]> {
	const res = await room_call(env, ws, id, '/leave', {
		method: 'POST',
		body: JSON.stringify({ uid })
	}).catch(() => null);
	if (!res?.ok) return [];
	return (await res.json()).members;
}

export async function room_members(env: QEnv, ws: Fetcher, id: string): Promise<string[]> {
	const res = await room_call(env, ws, id, '/members').catch(() => null);
	if (!res?.ok) return [];
	return (await res.json()).members;
}

export async function room_is_member(
	env: QEnv,
	ws: Fetcher,
	id: string,
	uid: string
): Promise<boolean> {
	const res = await room_call(env, ws, id, `/is-member?uid=${uid}`).catch(() => null);
	if (!res?.ok) return false;
	return (await res.json()).ok;
}

export async function hub_sv_get(env: QEnv, ws: Fetcher, uid: string): Promise<number> {
	const res = await call(env, ws, uid, '/sv').catch(() => null);
	if (!res?.ok) return 0;
	return (await res.json()).sv;
}

export async function hub_sv_set(env: QEnv, ws: Fetcher, uid: string, sv: number): Promise<void> {
	await call(env, ws, uid, '/sv', { method: 'POST', body: JSON.stringify({ sv }) });
}

// Only call where a stale session actually matters (ws handshake, credential changes):
// every request is authenticated by the HMAC signature in handle, no DO round trip needed.
export async function assert_session_current(
	env: QEnv,
	ws: Fetcher,
	user: { id: string },
	v: number
): Promise<void> {
	const sv = await hub_sv_get(env, ws, user.id);
	if (sv > v) throw error(401, 'revoked');
}

export async function hub_unsub(
	env: QEnv,
	ws: Fetcher,
	uid: string,
	endpoint: string
): Promise<void> {
	await call(env, ws, uid, '/unsub', { method: 'POST', body: JSON.stringify({ ep: endpoint }) });
}
