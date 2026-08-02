import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { hub_convs, ChatHubError } from '$lib/server/hub_client';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) throw error(401, 'auth');
	try {
		const r = await hub_convs(env, locals.x2_ws, locals.user.id);
		return json({ r });
	} catch (e) {
		throw error(503, e instanceof ChatHubError ? `hub_${e.reason}` : 'hub_error');
	}
};
