import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { get_user_names } from '$lib/server/chat';
import { list_folders } from '$lib/server/folders';
import { hub_convs } from '$lib/server/hub_client';
import { list_mutes } from '$lib/server/mute';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) throw error(401, 'auth');
	const uid = locals.user.id;
	const [convs, folders, mutes] = await Promise.all([
		hub_convs(env, locals.x2_ws, uid),
		list_folders(env, uid, 'c'),
		list_mutes(env, locals.x2_ws, uid)
	]);
	const peers = convs.map((c) => c.peer ?? c.group ?? '').filter(Boolean);
	const names = await get_user_names(env, peers);
	const muted = new Set(mutes.filter((m) => m.k === 'u').map((m) => m.tg));
	const r = convs.map((c) => ({
		...c,
		name: names[c.peer ?? c.group ?? ''] ?? c.peer ?? c.group ?? '',
		muted: muted.has(c.peer ?? '')
	}));
	const by_conv: Record<string, number> = {};
	for (const c of convs) {
		if (c.unread) {
			const peer = c.peer ?? c.group ?? '';
			if (peer) by_conv[peer] = c.unread;
		}
	}
	return { convs: r, folders, unread: by_conv };
};
