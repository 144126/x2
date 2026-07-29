import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { assign_conv, unassign_conv, delete_folder } from '$lib/server/folders';

// assign a conversation to this folder
export const POST: RequestHandler = async ({ request, params, locals }) => {
	if (!locals.user) throw error(401, 'auth');
	const b = (await request.json().catch(() => null)) as { conv?: string } | null;
	const conv = b?.conv?.trim();
	if (!conv) throw error(400, 'conv required');
	const ok = await assign_conv(env, locals.user.id, params.id, conv);
	if (!ok) throw error(404, 'not found');
	return json({ ok: true });
};

// DELETE ?conv=X unassigns a conversation; DELETE with no `conv` deletes the whole folder
export const DELETE: RequestHandler = async ({ url, params, locals }) => {
	if (!locals.user) throw error(401, 'auth');
	const conv = url.searchParams.get('conv');
	const ok = conv
		? await unassign_conv(env, locals.user.id, params.id, conv)
		: await delete_folder(env, locals.user.id, params.id);
	if (!ok) throw error(404, 'not found');
	return json({ ok: true });
};
