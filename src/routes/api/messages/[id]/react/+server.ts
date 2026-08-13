import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { toggle_reaction, get_message } from '$lib/server/chat';
import { is_member, get_group } from '$lib/server/group';

async function relay_reaction(
	env: unknown,
	ws: Fetcher,
	m: { gr?: string; f: string; t: string },
	id: string,
	rx: Record<string, string[]>
): Promise<void> {
	const members = m.gr
		? ((await get_group(env as never, m.gr))?.members ?? [m.f, m.t])
		: [m.f, m.t];
	await ws.fetch('https://x2-ws/relay', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ type: 'reaction', id, members, rx })
	});
}

export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) throw error(401, 'auth');
	const { emoji } = (await request.json().catch(() => ({}))) as { emoji?: string };
	if (!emoji) throw error(400, 'emoji required');
	const m = await get_message(env, params.id);
	if (!m) throw error(404, 'not found');
	const uid = locals.user.id;
	const allowed = m.gr ? await is_member(env, locals.x2_ws, m.gr, uid) : m.f === uid || m.t === uid;
	if (!allowed) throw error(403, 'not a participant');
	const rx = await toggle_reaction(env, uid, params.id, emoji);
	locals.bg(relay_reaction(env, locals.x2_ws, m, params.id, rx).catch(() => {}));
	return json({ rx });
};
