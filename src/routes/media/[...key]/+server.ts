import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { get_image, sign_key, is_vo_key } from '$lib/server/media';
import { get_secret } from '$lib/server/qdrant';

export const GET: RequestHandler = async ({ params, url, locals, platform }) => {
	const exp = Number(url.searchParams.get('e'));
	const sig = url.searchParams.get('s');
	const vo = is_vo_key(params.key);

	if (exp && sig) {
		if (exp < Date.now()) throw error(403, 'expired');
		const secret = await get_secret(env.SECRET);
		if (!secret || sig !== (await sign_key(secret, params.key, exp))) throw error(403, 'bad_sig');
	} else {
		// A view-once object is never readable on a session alone. The only way in is the
		// two-minute signature that /api/messages/[id]/view mints, once, per recipient.
		if (vo) throw error(403, 'signature_required');
		if (!locals.user) throw error(401, 'auth');
	}

	const bucket = platform?.env?.MEDIA;
	if (!bucket) throw error(503, 'media_unconfigured');
	const obj = await get_image(bucket, params.key);
	if (!obj) throw error(404, 'not found');
	const h = new Headers();
	obj.writeHttpMetadata(h);
	h.set('etag', obj.httpEtag);
	// view-once bytes must not survive in a disk cache after the object itself is destroyed
	h.set('cache-control', vo ? 'no-store, private' : 'public, max-age=86400, immutable');
	return new Response(obj.body, { headers: h });
};
