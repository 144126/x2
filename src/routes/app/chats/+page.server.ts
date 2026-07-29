import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { list_conversations, get_user_name } from '$lib/server/chat';
import { ensure } from '$lib/server/qdrant';
import { list_folders } from '$lib/server/folders';
import { unread_by_conv } from '$lib/server/unread';
import { list_mutes } from '$lib/server/mute';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) throw error(401, 'auth');
	await ensure(env);
	const uid = locals.user.id;
	const [convs, folders, unread, mutes] = await Promise.all([
		list_conversations(env, uid),
		list_folders(env, uid),
		unread_by_conv(env, uid),
		list_mutes(env, uid)
	]);
	const muted = new Set(mutes.filter((m) => m.k === 'u').map((m) => m.tg));
	const r = await Promise.all(
		convs.map(async (c) => ({
			...c,
			name: await get_user_name(env, c.peer),
			muted: muted.has(c.peer)
		}))
	);
	return { convs: r, folders, unread };
};
