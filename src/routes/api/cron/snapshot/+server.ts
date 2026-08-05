import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { get_secret } from '$lib/server/qdrant';
import { snapshot_api, snapshot_key } from '../../../../../scripts/snapshot-qdrant.mjs';

// Daily Qdrant snapshot shipped to R2. The Qdrant-side snapshot is created, downloaded,
// uploaded via the MEDIA R2 binding under qdrant/<collection>/<utc-date>.snapshot, then
// deleted from the cluster so its disk does not fill. Guarded by the same SECRET bearer
// check as dispatch-scheduled; the ws worker's cron calls it once a day (00:00 UTC).
export const POST: RequestHandler = async ({ request, platform }) => {
	const auth = request.headers.get('authorization');
	const expected = await get_secret(env.SECRET);
	if (!expected || auth !== `Bearer ${expected}`) throw error(401, 'unauthorized');

	const bucket = platform?.env?.MEDIA;
	if (!bucket) throw error(500, 'no media binding');

	const qurl = await get_secret(env.QDRANT_URL, env.DEV_QDRANT_URL);
	const qkey = await get_secret(env.QDRANT_KEY, env.DEV_QDRANT_KEY);
	if (!qurl || !qkey) throw error(500, 'no qdrant credentials');

	const api = snapshot_api(qurl, env.QDRANT_COLLECTION ?? 'x2live', qkey);
	const c = await fetch(api.create.url, { method: 'POST', headers: api.create.headers });
	if (!c.ok) throw error(502, `snapshot create failed ${c.status}`);
	const name = (await c.json()).result?.name;
	if (!name) throw error(502, 'snapshot create returned no name');

	try {
		const d = await fetch(api.download(name).url, { headers: api.download(name).headers });
		if (!d.ok) throw error(502, `snapshot download failed ${d.status}`);
		const body = await d.arrayBuffer();
		const key = snapshot_key(env.QDRANT_COLLECTION ?? 'x2live', new Date());
		await bucket.put(key, body);
	} finally {
		await fetch(api.remove(name).url, {
			method: 'DELETE',
			headers: api.remove(name).headers
		}).catch(() => {});
	}
	return json({ ok: true });
};
