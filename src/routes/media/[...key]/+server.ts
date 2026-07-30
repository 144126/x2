import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { get_image, sign_key } from '$lib/server/media';
import { get_secret } from '$lib/server/qdrant';

export const GET: RequestHandler = async ({ params, url, locals, platform }) => {
	const exp = Number(url.searchParams.get('e'));
	const sig = url.searchParams.get('s');

	if (exp && sig) {
		if (exp < Date.now()) throw error(403, 'expired');
		const secret = await get_secret(env.SECRET);
		if (!secret || sig !== (await sign_key(secret, params.key, exp))) throw error(403, 'bad_sig');
	} else {
		if (!locals.user) throw error(401, 'auth');
	}

	const bucket = platform?.env?.MEDIA;
	if (!bucket) throw error(503, 'media_unconfigured');
	const obj = await get_image(bucket, params.key);
	if (!obj) throw error(404, 'not found');
	const h = new Headers();
	obj.writeHttpMetadata(h);
	h.set('etag', obj.httpEtag);
	h.set('cache-control', 'public, max-age=86400, immutable');
	return new Response(obj.body, { headers: h });
};
