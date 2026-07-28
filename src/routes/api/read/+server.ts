import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { mark_read, unread_by_conv } from '$lib/server/unread';
import { list_groups } from '$lib/server/group';
import { group_conv_id } from '$lib/server/chat';

async function my_group_convs(uid: string): Promise<string[]> {
	const groups = await list_groups(env, uid);
	return groups.map((g) => group_conv_id(g.id));
}

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) throw error(401, 'auth');
	const group_convs = await my_group_convs(locals.user.id);
	const by_conv = await unread_by_conv(env, locals.user.id, group_convs);
	const total = Object.values(by_conv).reduce((a, b) => a + b, 0);
	return json({ total, by_conv });
};

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) throw error(401, 'auth');
	const b = (await request.json().catch(() => null)) as { conv?: string; ts?: number } | null;
	if (!b?.conv) throw error(400, 'conv required');
	await mark_read(env, locals.user.id, b.conv, b.ts);
	const group_convs = await my_group_convs(locals.user.id);
	const by_conv = await unread_by_conv(env, locals.user.id, group_convs);
	const total = Object.values(by_conv).reduce((a, x) => a + x, 0);
	return json({ total });
};
