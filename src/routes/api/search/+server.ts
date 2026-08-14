import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import {
	ensure,
	search,
	scroll,
	f,
	eq,
	range,
	get_secret,
	ZV,
	type Cond
} from '$lib/server/qdrant';
import { embed } from '$lib/server/or';
import { guard } from '$lib/server/rl';
import { is_device_only } from '$lib/server/user';
import type { User } from '$lib/types';

const WANT = 20;
const PAGE = 100;
const MAX_PAGES = 3;

async function presence(
	x2_ws: RequestHandler['locals']['x2_ws'],
	ids: string[]
): Promise<Set<string> | null> {
	if (!ids.length) return new Set();
	try {
		const secret = await get_secret(env.SECRET);
		const res = await x2_ws.fetch('https://x2-ws/online', {
			method: 'POST',
			headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
			body: JSON.stringify({ uids: ids })
		});
		if (!res.ok) return null;
		const data = (await res.json()) as { online?: unknown };
		return Array.isArray(data?.online) ? new Set(data.online as string[]) : null;
	} catch {
		return null;
	}
}

export const GET: RequestHandler = async ({ url, locals, platform }) => {
	if (!locals.user) throw error(401, 'auth');
	await guard(platform, 'RL_SEARCH', locals.user.id);
	const q = url.searchParams.get('q')?.trim() ?? '';
	await ensure(env);
	const conds: Cond[] = [eq('s', 'u')];
	const gender = url.searchParams.get('gender')?.trim();
	if (gender) conds.push(eq('r', gender));
	const country = url.searchParams.get('country')?.trim();
	if (country) conds.push(eq('co', country));
	const state = url.searchParams.get('state')?.trim();
	if (state) conds.push(eq('st', state));
	const age_min = Number(url.searchParams.get('age_min'));
	const age_max = Number(url.searchParams.get('age_max'));
	if (age_min || age_max) conds.push(range('ag', age_min || undefined, age_max || undefined));
	const only_online = url.searchParams.get('online') === '1';

	const has_query = !!q;
	const vec = has_query ? await embed(env, q) : ZV;
	const has_real_vec = has_query && vec.some((v) => v !== 0);

	const fetch_page = (limit: number, offset: number) =>
		has_real_vec
			? search(env, vec, f(...conds), limit, offset)
			: scroll(env, f(...conds), limit, offset);

	const { Country } = await import('country-state-city');
	const to_row = (h: { id: string | number; payload: Record<string, unknown>; score?: number }) => {
		const u = h.payload as unknown as User;
		const wu =
			u.w && u.co
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
	};

	const out: ReturnType<typeof to_row>[] = [];
	let filtered = true;

	// a device account is a session, not someone who joined: it has no profile to show and
	// never asked to be listed. It becomes searchable the moment it gains a real credential.
	// Both filters drop rows, so every path pages now — a full page can be entirely hidden.
	for (let page = 0; page < MAX_PAGES && out.length < WANT; page++) {
		const hits = await fetch_page(PAGE, page * PAGE);
		if (!hits.length) break;
		let rows = hits
			.filter(
				(h) =>
					String(h.id) !== locals.user!.id &&
					!is_device_only(h.payload as unknown as Pick<User, 'h' | 'o'>)
			)
			.map(to_row);
		if (only_online) {
			const live = await presence(
				locals.x2_ws,
				rows.map((x) => x.id)
			);
			if (live === null) {
				filtered = false;
				out.push(...rows);
				break;
			}
			rows = rows.filter((x) => live.has(x.id)).map((x) => ({ ...x, online: true }));
		}
		out.push(...rows);
		if (hits.length < PAGE) break;
	}

	return json({ r: out.slice(0, WANT), filtered });
};
