import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { total_unread, mark_read, unread_by_conv } from '$lib/server/unread';
import { list_groups } from '$lib/server/group';
import { group_conv_id } from '$lib/server/chat';
import { list_mutes, muted_convs } from '$lib/server/mute';

async function my_group_convs(uid: string): Promise<string[]> {
	const groups = await list_groups(env, uid);
	return groups.map((g) => group_conv_id(g.id));
}

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) throw error(401, 'auth');
	const group_convs = await my_group_convs(locals.user.id);
	const by_conv = await unread_by_conv(env, locals.user.id, group_convs);
	const mutes = await list_mutes(env, locals.user.id);
	const silent = muted_convs(locals.user.id, mutes);
	const total = Object.entries(by_conv)
		.filter(([conv]) => !silent.includes(conv))
		.reduce((n, [, count]) => n + count, 0);
	return json({ total, by_conv, muted: silent });
};

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) throw error(401, 'auth');
	const b = (await request.json().catch(() => null)) as { conv?: string; ts?: number } | null;
	if (!b?.conv) throw error(400, 'conv required');
	await mark_read(env, locals.user.id, b.conv, b.ts);
	const total = await total_unread(env, locals.user.id, await my_group_convs(locals.user.id));
	return json({ total });
};
