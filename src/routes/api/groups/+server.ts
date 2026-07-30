import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { save_group, search_groups, list_groups } from '$lib/server/group';
import { guard } from '$lib/server/rl';

// GET /api/groups?q=…  — semantic search over name + description
// GET /api/groups?mine=1 — groups you belong to
export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) throw error(401, 'auth');
	if (url.searchParams.get('mine')) return json({ r: await list_groups(env, locals.user.id) });
	const q = url.searchParams.get('q')?.trim() ?? '';
	const country = url.searchParams.get('country')?.trim() || undefined;
	const state = url.searchParams.get('state')?.trim() || undefined;
	const city = url.searchParams.get('city')?.trim() || undefined;
	if (!q && !country && !state && !city) return json({ r: await list_groups(env) });
	return json({ r: await search_groups(env, q, { country, state, city }) });
};

export const POST: RequestHandler = async ({ request, locals, platform }) => {
	if (!locals.user) throw error(401, 'auth');
	await guard(platform, 'RL_SEARCH', locals.user.id);
	const b = (await request.json().catch(() => null)) as {
		name?: string;
		description?: string;
		country?: string;
		state?: string;
		city?: string;
	};
	const name = b?.name?.trim();
	if (!name) throw error(400, 'name required');
	return json({
		g: await save_group(env, locals.user.id, {
			name,
			description: b?.description,
			country: b?.country,
			state: b?.state,
			city: b?.city
		})
	});
};
