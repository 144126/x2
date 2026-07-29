import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { get_secret } from '$lib/server/qdrant';
import { send_scheduled_batch } from '$lib/server/scheduled';

// Called by the x2-ws worker's cron trigger (adapter-cloudflare's generated worker doesn't
// expose a `scheduled` hook, so the cron lives on ws, which already has a Qdrant binding and
// calls back here — the one place that also knows how to push-notify and relay over the socket).
export const POST: RequestHandler = async ({ request, locals }) => {
	const auth = request.headers.get('authorization');
	const expected = await get_secret(env.SECRET);
	if (!expected || auth !== `Bearer ${expected}`) throw error(401, 'unauthorized');

	await send_scheduled_batch(env, locals.x2_ws, Date.now());
	return json({ ok: true });
};
