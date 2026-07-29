import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { ensure, retrieve_one } from '$lib/server/qdrant';
import { shared_groups } from '$lib/server/group';
import { is_muted } from '$lib/server/mute';
import type { User } from '$lib/types';

export const load: PageServerLoad = async ({ params, locals }) => {
	if (!locals.user) throw error(401, 'auth');
	await ensure(env);
	const u = (await retrieve_one(env, params.id))?.payload as unknown as User | undefined;
	if (!u) throw error(404, 'not found');
	const { Country } = await import('country-state-city');
	const wu =
		u.w && u.co
			? `https://wa.me/${Country.getCountryByCode(u.co)?.phonecode ?? ''}${u.w}`
			: undefined;
	const shared =
		params.id === locals.user.id ? [] : await shared_groups(env, params.id, locals.user.id);
	const muted = await is_muted(env, locals.user.id, params.id);
	return { id: params.id, u, wu, shared, muted };
};
