// Image storage on R2. Keys are `<uid>/<uuid>.<ext>` so a user's uploads are one prefix
// and nothing a client sends decides the path.
const TYPES: Record<string, string> = {
	'image/png': 'png',
	'image/jpeg': 'jpg',
	'image/webp': 'webp',
	'image/gif': 'gif'
};

export const MAX_BYTES = 8 * 1024 * 1024;

export function media_url(key: string): string {
	return `/media/${key}`;
}

/** null when the file isn't an image we accept, or is too big */
export async function put_image(
	bucket: MediaBucket,
	uid: string,
	file: Blob
): Promise<{ key: string; url: string } | null> {
	const ext = TYPES[file.type];
	if (!ext || file.size === 0 || file.size > MAX_BYTES) return null;
	const key = `${uid}/${crypto.randomUUID()}.${ext}`;
	await bucket.put(key, await file.arrayBuffer(), {
		httpMetadata: { contentType: file.type, cacheControl: 'public, max-age=31536000, immutable' }
	});
	return { key, url: media_url(key) };
}

export async function get_image(bucket: MediaBucket, key: string): Promise<MediaObject | null> {
	return (await bucket.get(key)) ?? null;
}

/** only the uploader may delete — ownership is encoded in the key prefix */
export async function delete_image(bucket: MediaBucket, uid: string, key: string): Promise<boolean> {
	if (!key.startsWith(`${uid}/`)) return false;
	await bucket.delete(key);
	return true;
}
