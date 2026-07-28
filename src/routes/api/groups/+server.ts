import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { save_group, search_groups, list_groups } from '$lib/server/group';

// GET /api/groups?q=…  — semantic search over name + description
// GET /api/groups?mine=1 — groups you belong to
export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) throw error(401, 'auth');
	if (url.searchParams.get('mine')) return json({ r: await list_groups(env, locals.user.id) });
	const q = url.searchParams.get('q')?.trim();
	return json({ r: q ? await search_groups(env, q) : await list_groups(env) });
};

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) throw error(401, 'auth');
	const b = (await request.json().catch(() => null)) as { name?: string; description?: string };
	const name = b?.name?.trim();
	if (!name) throw error(400, 'name required');
	return json({ g: await save_group(env, locals.user.id, { name, description: b?.description }) });
};
