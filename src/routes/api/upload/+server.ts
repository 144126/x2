import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { put_image, put_file, MAX_BYTES, MAX_FILE_BYTES } from '$lib/server/media';
import { get_secret } from '$lib/server/qdrant';
import { guard } from '$lib/server/rl';

export const POST: RequestHandler = async ({ request, url, locals, platform }) => {
	if (!locals.user) throw error(401, 'auth');
	await guard(platform, 'RL_UPLOAD', locals.user.id);
	const bucket = platform?.env?.MEDIA;
	if (!bucket) throw error(503, 'media_unconfigured');

	const secret = await get_secret(env.SECRET);
	if (!secret) throw error(503, 'no_secret');

	// a view-once upload lands under its own R2 prefix, which /media refuses to serve
	// without a fresh signature
	const vo = url.searchParams.get('vo') === '1';

	const form = await request.formData().catch(() => null);
	const file = form?.get('file');
	if (!(file instanceof Blob)) throw error(400, 'file required');

	if (file.type.startsWith('image/')) {
		if (file.size > MAX_BYTES) throw error(413, 'max 8MB');
		const saved = await put_image(bucket, locals.user.id, file, secret, vo);
		if (!saved) throw error(415, 'png, jpeg, webp or gif only');
		return json(saved);
	}

	if (file.size > MAX_FILE_BYTES) throw error(413, 'max 20MB');
	const name = file instanceof File ? file.name : 'file';
	const saved = await put_file(bucket, locals.user.id, file, name, secret, vo);
	if (!saved) throw error(415, 'unsupported file type');
	return json(saved);
};
