import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { get_group, update_group, delete_group, join_group, leave_group } from '$lib/server/group';

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) throw error(401, 'auth');
	const g = await get_group(env, params.id);
	if (!g) throw error(404, 'no group');
	return json({ g });
};

// PATCH edits (owner only); POST {action:'join'|'leave'} changes membership
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) throw error(401, 'auth');
	const b = (await request.json().catch(() => null)) as {
		name?: string;
		description?: string;
		country?: string;
		state?: string;
		city?: string;
	};
	const g = await update_group(env, params.id, locals.user.id, {
		name: b?.name,
		description: b?.description,
		country: b?.country,
		state: b?.state,
		city: b?.city
	});
	if (!g) throw error(403, 'owner only');
	return json({ g });
};

export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) throw error(401, 'auth');
	const b = (await request.json().catch(() => null)) as { action?: string };
	const g =
		b?.action === 'leave'
			? await leave_group(env, params.id, locals.user.id)
			: await join_group(env, params.id, locals.user.id);
	if (!g) throw error(400, b?.action === 'leave' ? 'owner cannot leave' : 'no group');
	return json({ g });
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) throw error(401, 'auth');
	if (!(await delete_group(env, params.id, locals.user.id))) throw error(403, 'owner only');
	return json({ ok: true });
};
