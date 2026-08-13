import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { get_secret } from '$lib/server/qdrant';
import { guard } from '$lib/server/rl';

export const POST: RequestHandler = async ({ locals, platform }) => {
	if (!locals.user) throw error(401, 'auth');
	await guard(platform, 'RL_SEARCH', locals.user.id);

	const key_id = await get_secret(env.TURN_KEY_ID);
	const api_token = await get_secret(env.TURN_KEY_API_TOKEN);
	if (!key_id || !api_token) throw error(503, 'turn_unconfigured');

	const res = await fetch(
		`https://rtc.live.cloudflare.com/v1/turn/keys/${key_id}/credentials/generate`,
		{
			method: 'POST',
			headers: { authorization: `Bearer ${api_token}`, 'content-type': 'application/json' },
			body: JSON.stringify({ ttl: 600 })
		}
	).catch(() => null);
	if (!res || !res.ok) return json({ error: 'turn_unavailable' }, { status: 503 });

	const body = (await res.json()) as { iceServers: RTCIceServer | RTCIceServer[] };
	const raw = body.iceServers;
	const iceServers = Array.isArray(raw) ? raw : raw ? [raw] : [];
	return json({ iceServers });
};
