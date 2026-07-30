import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { hub_convs } from '$lib/server/hub_client';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) throw error(401, 'auth');
	const r = await hub_convs(env, locals.x2_ws, locals.user.id);
	return json({ r });
};
