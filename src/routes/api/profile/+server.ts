import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { save_profile } from '$lib/server/profile';
import { get_user } from '$lib/server/user';
import { ensure } from '$lib/server/qdrant';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) throw error(401, 'auth');
	await ensure(env);
	const p = await get_user(env, locals.user.id);
	return json({ p: p ?? { id: locals.user.id, u: locals.user.username } });
};

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) throw error(401, 'auth');
	const b = (await request.json().catch(() => null)) as {
		username?: string;
		about?: string;
		interests?: string[];
		age?: number;
		gender?: string;
		country?: string;
		state?: string;
		city?: string;
		whatsapp?: string;
		show_interests?: boolean;
	};
	await save_profile(env, locals.user.id, {
		username: b.username,
		about: b.about,
		interests: b.interests,
		age: b.age,
		gender: b.gender,
		country: b.country,
		state: b.state,
		city: b.city,
		whatsapp: b.whatsapp,
		show_interests: typeof b.show_interests === 'boolean' ? b.show_interests : undefined
	});
	return json({ ok: true });
};
