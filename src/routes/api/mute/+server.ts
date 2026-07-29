import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { mute, unmute, list_mutes } from '$lib/server/mute';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) throw error(401, 'auth');
	return json({ mutes: await list_mutes(env, locals.user.id) });
};

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) throw error(401, 'auth');
	const b = (await request.json().catch(() => null)) as {
		target?: string;
		kind?: string;
		until?: number;
	} | null;
	const target = b?.target?.trim();
	const kind = b?.kind;
	if (!target) throw error(400, 'target required');
	if (kind !== 'u' && kind !== 'r') throw error(400, 'kind must be u or r');
	if (target === locals.user.id) throw error(400, 'cannot mute yourself');
	const until = typeof b?.until === 'number' && b.until > Date.now() ? b.until : 0;
	return json({ mute: await mute(env, locals.user.id, target, kind, until) });
};

export const DELETE: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) throw error(401, 'auth');
	const target = url.searchParams.get('target')?.trim();
	if (!target) throw error(400, 'target required');
	await unmute(env, locals.user.id, target);
	return json({ ok: true });
};
