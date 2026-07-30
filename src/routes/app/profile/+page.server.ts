import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { get_user, get_user_name } from '$lib/server/user';
import { get_group } from '$lib/server/group';
import { ensure } from '$lib/server/qdrant';
import { ensure_partner_code } from '$lib/server/partner';
import { list_mutes, type Mute } from '$lib/server/mute';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) throw error(401, 'auth');
	await ensure(env);
	const ac = await ensure_partner_code(env, locals.user.id);
	const p = await get_user(env, locals.user.id);
	const raw = await list_mutes(env, locals.user.id);
	const mutes = await Promise.all(
		raw.map(async (m: Mute) => {
			const name =
				m.k === 'r' ? ((await get_group(env, m.tg))?.name ?? m.tg) : await get_user_name(env, m.tg);
			return { target: m.tg, kind: m.k, until: m.until, name };
		})
	);
	return { id: locals.user.id, p: p ?? { id: locals.user.id, u: locals.user.username, ac }, partner_code: ac, mutes, geo: locals.geo };
};
