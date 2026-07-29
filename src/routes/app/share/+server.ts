import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { put_image } from '$lib/server/media';

export const POST: RequestHandler = async ({ request, locals, platform }) => {
	if (!locals.user) throw redirect(303, '/login');

	const form = await request.formData();
	const title = (form.get('title') as string | null)?.trim();
	const text = (form.get('text') as string | null)?.trim();
	const url = (form.get('url') as string | null)?.trim();
	const image = form.get('image');

	const share_text = [text || title, url].filter(Boolean).join(' ').trim();

	const params = new URLSearchParams();
	if (share_text) params.set('share_text', share_text);

	if (image instanceof Blob && image.size > 0) {
		const bucket = platform?.env?.MEDIA;
		const stored = bucket ? await put_image(bucket, locals.user.id, image) : null;
		if (stored) params.set('share_image', stored.key);
	}

	const qs = params.toString();
	throw redirect(303, qs ? `/app/chats?${qs}` : '/app/chats');
};
