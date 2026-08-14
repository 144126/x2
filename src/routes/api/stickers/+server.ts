import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { get_user, patch_user } from '$lib/server/user';
import { get_secret } from '$lib/server/qdrant';
import { guard } from '$lib/server/rl';
import { remote_ok } from '$lib/stickers';

/** a personal pack any bigger than this is a scrolling problem, not a feature */
const MAX_STICKERS = 60;

const KLIPY = 'https://api.klipy.com/api/v1';

type KlipyItem = {
	type?: string;
	file?: Record<string, Record<string, { url?: string } | undefined> | undefined>;
};

// klipy serves each sticker at every size in four formats. md is the one that stays sharp in a
// 104px bubble on a dense screen and still never passed 14kb across a live page of results
const rendition = (it: KlipyItem): string | undefined => {
	const f = it.file ?? {};
	return f.md?.webp?.url ?? f.sm?.webp?.url ?? f.hd?.webp?.url;
};

// no key set means no search, which is why the picker falls back to the built-in pack whenever
// this comes back empty
async function search_klipy(q: string, cid?: string): Promise<string[]> {
	const key = await get_secret(env.KLIPY_KEY);
	if (!key) return [];
	const res = await fetch(
		`${KLIPY}/${key}/stickers/search?q=${encodeURIComponent(q)}&per_page=24` +
			(cid ? `&customer_id=${encodeURIComponent(cid)}` : '')
	).catch(() => null);
	if (!res?.ok) return [];
	const b = (await res.json().catch(() => null)) as { data?: { data?: KlipyItem[] } } | null;
	return (
		(b?.data?.data ?? [])
			// klipy sells the right to drop an ad into a page of results, and an ad is not a sticker
			// anyone should be able to send
			.filter((it) => it.type !== 'ad')
			.map(rendition)
			.filter((u): u is string => !!u && remote_ok(u))
	);
}

export const GET: RequestHandler = async ({ url, locals, platform }) => {
	const q = url.searchParams.get('q')?.trim();
	if (q) {
		// every signed-out visitor shares one bucket on purpose: a test klipy key allows
		// 100 calls an hour in total, and a guest cannot be told apart from a script
		await guard(platform, 'RL_SEARCH', locals.user?.id ?? 'anon');
		return json({ r: await search_klipy(q, locals.user?.id) });
	}
	if (!locals.user) throw error(401, 'auth');
	const u = await get_user(env, locals.user.id);
	return json({ r: u?.sp ?? [] });
};

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) throw error(401, 'auth');
	const b = (await request.json().catch(() => null)) as { key?: string } | null;
	const key = b?.key?.trim();
	if (!key) throw error(400, 'key required');
	const u = await get_user(env, locals.user.id);
	if (!u) throw error(404, 'no user');
	const sp = [key, ...(u.sp ?? []).filter((k) => k !== key)].slice(0, MAX_STICKERS);
	await patch_user(env, locals.user.id, { sp });
	return json({ r: sp });
};

export const DELETE: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) throw error(401, 'auth');
	const key = url.searchParams.get('key');
	if (!key) throw error(400, 'key required');
	const u = await get_user(env, locals.user.id);
	if (!u) throw error(404, 'no user');
	const sp = (u.sp ?? []).filter((k) => k !== key);
	await patch_user(env, locals.user.id, { sp });
	return json({ r: sp });
};
