import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { scroll, remove, f, eq } from '$lib/server/qdrant';

export const POST: RequestHandler = async () => {
	const users = await scroll(env, f(eq('s', 'u')));
	const probe = users.filter((u) => (u.payload?.u as string)?.startsWith('probe'));
	const ids = probe.map((u) => u.id as string);
	await remove(env, ids);
	return json({ deleted: ids.length });
};
