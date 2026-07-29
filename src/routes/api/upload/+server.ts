import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { put_image, put_file, MAX_BYTES, MAX_FILE_BYTES } from '$lib/server/media';

export const POST: RequestHandler = async ({ request, locals, platform }) => {
	if (!locals.user) throw error(401, 'auth');
	const bucket = platform?.env?.MEDIA;
	if (!bucket) throw error(503, 'media_unconfigured');

	const form = await request.formData().catch(() => null);
	const file = form?.get('file');
	if (!(file instanceof Blob)) throw error(400, 'file required');

	if (file.type.startsWith('image/')) {
		if (file.size > MAX_BYTES) throw error(413, 'max 8MB');
		const saved = await put_image(bucket, locals.user.id, file);
		if (!saved) throw error(415, 'png, jpeg, webp or gif only');
		return json(saved);
	}

	if (file.size > MAX_FILE_BYTES) throw error(413, 'max 20MB');
	const name = file instanceof File ? file.name : 'file';
	const saved = await put_file(bucket, locals.user.id, file, name);
	if (!saved) throw error(415, 'unsupported file type');
	return json(saved);
};
