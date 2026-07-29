import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { save_folder, list_folders } from '$lib/server/folders';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) throw error(401, 'auth');
	return json({ folders: await list_folders(env, locals.user.id) });
};

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) throw error(401, 'auth');
	const b = (await request.json().catch(() => null)) as { name?: string } | null;
	const name = b?.name?.trim();
	if (!name) throw error(400, 'name required');
	const folder = await save_folder(env, locals.user.id, name);
	return json({ folder });
};
