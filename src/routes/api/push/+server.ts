import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { get_secret } from '$lib/server/qdrant';
import { save_sub, delete_sub } from '$lib/server/subs';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) throw error(401, 'auth');
	const key = await get_secret(env.VAPID_PUBLIC);
	if (!key) throw error(503, 'push not configured');
	return json({ key });
};

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) throw error(401, 'auth');
	const b = (await request.json().catch(() => null)) as {
		endpoint?: string;
		keys?: { p256dh?: string; auth?: string };
	} | null;
	if (!b?.endpoint || !b.keys?.p256dh || !b.keys?.auth) throw error(400, 'invalid subscription');
	try {
		await save_sub(
			env,
			locals.user.id,
			{ endpoint: b.endpoint, keys: { p256dh: b.keys.p256dh, auth: b.keys.auth } },
			request.headers.get('user-agent') ?? undefined
		);
	} catch {
		throw error(400, 'invalid subscription');
	}
	return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) throw error(401, 'auth');
	const b = (await request.json().catch(() => null)) as { endpoint?: string } | null;
	if (!b?.endpoint) throw error(400, 'endpoint required');
	await delete_sub(env, b.endpoint);
	return json({ ok: true });
};
