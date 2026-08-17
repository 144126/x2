import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { get_user, get_user_name } from '$lib/server/user';
import { get_group } from '$lib/server/group';
import { ensure } from '$lib/server/qdrant';
import { ensure_partner_code } from '$lib/server/partner';
import { can_lock } from '$lib/server/user';
import { list_mutes, type Mute } from '$lib/server/mute';
import type { User } from '$lib/types';

// A load return is serialised whole and shipped to the browser, so the record is copied field
// by field rather than spread. `h` and `pn` are the password and pin hashes and must never
// leave the worker.
function safe(u: User): User {
	const { a, ag, ci, co, i, m, p, r, st, u: name, w, tz, sp, ac, d, mp } = u;
	return { s: 'u', g: '', a, ag, ci, co, i, m, p, r, st, u: name, w, tz, sp, ac, d, mp };
}

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) throw error(401, 'auth');
	await ensure(env);
	const ac = await ensure_partner_code(env, locals.user.id);
	const p = await get_user(env, locals.user.id);
	const raw = await list_mutes(env, locals.x2_ws, locals.user.id);
	const mutes = await Promise.all(
		raw.map(async (m: Mute) => {
			const name =
				m.k === 'r' ? ((await get_group(env, m.tg))?.name ?? m.tg) : await get_user_name(env, m.tg);
			return { target: m.tg, kind: m.k, until: m.until, name };
		})
	);
	return {
		id: locals.user.id,
		p: p ? safe(p) : ({ s: 'u', g: '', d: 0, u: locals.user.username, ac } satisfies User),
		partner_code: ac,
		mutes,
		geo: locals.geo,
		pin: {
			on: !!p?.pn,
			allowed: !!p && can_lock(p),
			has_google: p?.o === 'google' || !!p?.gl,
			has_pw: !!p?.h
		}
	};
};
