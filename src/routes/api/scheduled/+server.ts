import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { list_scheduled, cancel_scheduled } from '$lib/server/scheduled';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) throw error(401, 'auth');
	return json({ scheduled: await list_scheduled(env, locals.user.id) });
};

export const DELETE: RequestHandler = async ({ locals, url }) => {
	if (!locals.user) throw error(401, 'auth');
	const id = url.searchParams.get('id');
	if (!id) throw error(400, 'id required');
	const ok = await cancel_scheduled(env, locals.user.id, id);
	if (!ok) throw error(404, 'not found');
	return json({ ok: true });
};
