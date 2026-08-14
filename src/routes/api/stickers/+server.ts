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

// klipy documents a `files` object per sticker but not which renditions sit inside it, so read
// every url the item carries and keep the webp — the smallest animated format they serve. no key
// set means no search, which is why the picker falls back to the built-in pack on an empty answer.
async function search_klipy(q: string, cid?: string): Promise<string[]> {
	const key = await get_secret(env.KLIPY_KEY);
	if (!key) return [];
	const res = await fetch(
		`${KLIPY}/${key}/stickers/search?q=${encodeURIComponent(q)}&per_page=24` +
			(cid ? `&customer_id=${encodeURIComponent(cid)}` : '')
	).catch(() => null);
	if (!res?.ok) return [];
	const b = (await res.json().catch(() => null)) as { data?: { data?: unknown[] } } | null;
	return (b?.data?.data ?? [])
		.map((it) => {
			const urls = (JSON.stringify(it).match(/https:\/\/[^"]+?\.(?:webp|gif)/g) ?? []).filter(
				remote_ok
			);
			return urls.find((u) => u.endsWith('.webp')) ?? urls[0];
		})
		.filter((u): u is string => !!u);
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
