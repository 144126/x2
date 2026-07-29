import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { ensure, search, f, eq, range, type Cond } from '$lib/server/qdrant';
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
	const country = url.searchParams.get('country')?.trim();
	if (country) conds.push(eq('co', country));
	const state = url.searchParams.get('state')?.trim();
	if (state) conds.push(eq('st', state));
	const age_min = Number(url.searchParams.get('age_min'));
	const age_max = Number(url.searchParams.get('age_max'));
	if (age_min || age_max)
		conds.push(range('ag', age_min || undefined, age_max || undefined));
	const only_online = url.searchParams.get('online') === '1';
	// over-fetch when filtering, since most candidates will be offline at any moment
	const hits = await search(env, vec, f(...conds), only_online ? 60 : 20);
	const { Country } = await import('country-state-city');
	let r = hits
		.map((h) => {
			const u = h.payload as unknown as User;
			const wu = u.w && u.co
				? `https://wa.me/${Country.getCountryByCode(u.co)?.phonecode ?? ''}${u.w}`
				: undefined;
			return {
				id: String(h.id),
				n: u.u ?? u.n,
				a: u.a,
				g: u.ag,
				r: u.r,
				co: u.co,
				st: u.st,
				ci: u.ci,
				w: u.w,
				wu,
				s: h.score
			};
		})
		.filter((x) => x.id !== locals.user!.id);

	// presence is per-uid in ChatHub with no bulk index, so this fans out one check per
	// candidate. Fails open: an unreachable ws worker returns everyone, flagged, rather
	// than an empty page that would read as "nobody is online".
	let filtered = true;
	if (only_online) {
		try {
			const res = await locals.x2_ws.fetch('https://x2-ws/online', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ uids: r.map((x) => x.id) })
			});
			const data = (await res.json()) as { online?: unknown };
			if (!Array.isArray(data?.online)) throw new Error('bad presence response');
			const live = new Set(data.online as string[]);
			r = r.filter((x) => live.has(x.id));
		} catch {
			filtered = false;
		}
	}

	return json({ r: r.slice(0, 20), filtered });
};
