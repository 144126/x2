import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { hub_unread, hub_mark_read } from '$lib/server/hub_client';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) throw error(401, 'auth');
	const { total, by_conv } = await hub_unread(env, locals.x2_ws, locals.user.id);
	return json({ total, by_conv });
};

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) throw error(401, 'auth');
	const b = (await request.json().catch(() => null)) as { conv?: string; ts?: number } | null;
	if (!b?.conv) throw error(400, 'conv required');
	const total = await hub_mark_read(env, locals.x2_ws, locals.user.id, b.conv, b.ts);
	return json({ total });
};
