import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { save_folder, list_folders } from '$lib/server/folders';

export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) throw error(401, 'auth');
	const k = url.searchParams.get('kind');
	const kind = k === 'r' || k === 'c' ? k : undefined;
	return json({ folders: await list_folders(env, locals.user.id, kind) });
};

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) throw error(401, 'auth');
	const b = (await request.json().catch(() => null)) as { name?: string; kind?: string } | null;
	const name = b?.name?.trim();
	if (!name) throw error(400, 'name required');
	const kind = b?.kind === 'r' ? 'r' : 'c';
	return json({ folder: await save_folder(env, locals.user.id, name, kind) });
};
