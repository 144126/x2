import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { ensure, search, f, eq, type Cond } from '$lib/server/qdrant';
import { embed } from '$lib/server/or';
import type { User } from '$lib/types';

export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) throw error(401, 'auth');
	const q = url.searchParams.get('q')?.trim();
	if (!q) throw error(400, 'q required');
	await ensure(env);
	const vec = await embed(env, q);
	const conds: Cond[] = [eq('s', 'u')];
	const gender = url.searchParams.get('gender')?.trim();
	if (gender) conds.push(eq('r', gender));
	const hits = await search(env, vec, f(...conds), 20);
	const r = hits
		.map((h) => {
			const u = h.payload as unknown as User;
			return {
				id: String(h.id),
				n: u.u ?? u.n,
				a: u.a,
				g: u.ag,
				r: u.r,
				s: h.score
			};
		})
		.filter((x) => x.id !== locals.user!.id);
	return json({ r });
};
