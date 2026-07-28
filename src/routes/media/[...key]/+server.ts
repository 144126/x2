import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { get_image } from '$lib/server/media';

// Signed-in users only: images are chat content, not public assets.
export const GET: RequestHandler = async ({ params, locals, platform }) => {
	if (!locals.user) throw error(401, 'auth');
	const bucket = platform?.env?.MEDIA;
	if (!bucket) throw error(503, 'media_unconfigured');
	const obj = await get_image(bucket, params.key);
	if (!obj) throw error(404, 'not found');
	const h = new Headers();
	obj.writeHttpMetadata(h);
	h.set('etag', obj.httpEtag);
	h.set('cache-control', 'private, max-age=31536000, immutable');
	return new Response(obj.body, { headers: h });
};
