import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { retrieve_one } from '$lib/server/qdrant';
import { whats_in_common } from '$lib/server/groq';
import type { User } from '$lib/types';

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) throw error(401, 'auth');
	const viewer = (await retrieve_one(env, locals.user.id))?.payload as unknown as User | undefined;
	const other = (await retrieve_one(env, params.id))?.payload as unknown as User | undefined;
	if (!viewer || !other) return json({ ok: false, reason: 'llm_error' });

	const r = await whats_in_common(env, locals.x2_ws, locals.user.id, viewer, other);
	return json(r.ok ? { ok: true, text: r.text } : r);
};
