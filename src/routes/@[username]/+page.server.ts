import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { ensure, retrieve_one } from '$lib/server/qdrant';
import { uid_by_username } from '$lib/server/username';
import { shared_groups } from '$lib/server/group';
import { is_muted } from '$lib/server/mute';
import { resolve_tz } from '$lib/tz';
import type { User } from '$lib/types';

export const load: PageServerLoad = async ({ params, locals }) => {
	await ensure(env);
	const id = await uid_by_username(env, params.username);
	if (!id) throw error(404, 'not found');
	const u = (await retrieve_one(env, id))?.payload as unknown as User | undefined;
	if (!u) throw error(404, 'not found');
	const me = locals.user?.id;
	const { Country } = await import('country-state-city');
	// a phone number reaches someone directly and forever, so it is the one field an account
	// buys. Everything else about a profile is open, including to a crawler.
	const w = me ? u.w : undefined;
	const wu =
		w && u.co
			? `https://wa.me/${Country.getCountryByCode(u.co)?.phonecode ?? ''}${w}`
			: undefined;
	const shared = me && me !== id ? await shared_groups(env, id, me) : [];
	const muted = me ? await is_muted(env, locals.x2_ws, me, id) : false;
	const tz = await resolve_tz({ tz: u.tz, co: u.co });
	return { id, u: { ...u, w }, wu, shared, muted, tz };
};
