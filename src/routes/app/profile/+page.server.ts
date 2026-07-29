import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { get_user } from '$lib/server/user';
import { ensure } from '$lib/server/qdrant';
import { ensure_partner_code } from '$lib/server/partner';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) throw error(401, 'auth');
	await ensure(env);
	const ac = await ensure_partner_code(env, locals.user.id);
	const p = await get_user(env, locals.user.id);
	return { p: p ?? { id: locals.user.id, u: locals.user.username, ac }, partner_code: ac };
};
