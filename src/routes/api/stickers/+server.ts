import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { get_user, patch_user } from '$lib/server/user';

/** a personal pack any bigger than this is a scrolling problem, not a feature */
const MAX_STICKERS = 60;

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) throw error(401, 'auth');
	const u = await get_user(env, locals.user.id);
	return json({ r: u?.sp ?? [] });
};

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) throw error(401, 'auth');
	const b = (await request.json().catch(() => null)) as { key?: string } | null;
	const key = b?.key?.trim();
	if (!key) throw error(400, 'key required');
	const u = await get_user(env, locals.user.id);
	if (!u) throw error(404, 'no user');
	const sp = [key, ...(u.sp ?? []).filter((k) => k !== key)].slice(0, MAX_STICKERS);
	await patch_user(env, locals.user.id, { sp });
	return json({ r: sp });
};

export const DELETE: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) throw error(401, 'auth');
	const key = url.searchParams.get('key');
	if (!key) throw error(400, 'key required');
	const u = await get_user(env, locals.user.id);
	if (!u) throw error(404, 'no user');
	const sp = (u.sp ?? []).filter((k) => k !== key);
	await patch_user(env, locals.user.id, { sp });
	return json({ r: sp });
};
