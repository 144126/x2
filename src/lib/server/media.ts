// Image storage on R2. Keys are `<uid>/<uuid>.<ext>` so a user's uploads are one prefix
// and nothing a client sends decides the path.
const TYPES: Record<string, string> = {
	'image/png': 'png',
	'image/jpeg': 'jpg',
	'image/webp': 'webp',
	'image/gif': 'gif'
};

export const MAX_BYTES = 8 * 1024 * 1024;

// generic (non-image) file attachments — conservative common-document allow-list
const FILE_TYPES: Record<string, string> = {
	'application/pdf': 'pdf',
	'application/zip': 'zip',
	'text/plain': 'txt',
	'application/msword': 'doc',
	'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
	'application/vnd.ms-excel': 'xls',
	'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx'
};

export const MAX_FILE_BYTES = 20 * 1024 * 1024;

export function media_url(key: string): string {
	return `/media/${key}`;
}

export async function sign_key(secret: string, key: string, exp: number): Promise<string> {
	const raw = new TextEncoder().encode(`${key}.${exp}`);
	const k = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(secret).slice(0, 32),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	const sig = await crypto.subtle.sign('HMAC', k, raw);
	return [...new Uint8Array(sig)]
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('')
		.slice(0, 32);
}

export function signed_media_url(key: string, exp: number, sig: string): string {
	return `/media/${key}?e=${exp}&s=${sig}`;
}

/** null when the file isn't an image we accept, or is too big */
export async function put_image(
	bucket: MediaBucket,
	uid: string,
	file: Blob,
	secret: string
): Promise<{ key: string; url: string } | null> {
	const ext = TYPES[file.type];
	if (!ext || file.size === 0 || file.size > MAX_BYTES) return null;
	const key = `${uid}/${crypto.randomUUID()}.${ext}`;
	await bucket.put(key, await file.arrayBuffer(), {
		httpMetadata: { contentType: file.type, cacheControl: 'public, max-age=31536000, immutable' }
	});
	const exp = Date.now() + 86_400_000;
	const sig = await sign_key(secret, key, exp);
	return { key, url: signed_media_url(key, exp, sig) };
}

/** null when the file's type isn't in the document allow-list, or is too big */
export async function put_file(
	bucket: MediaBucket,
	uid: string,
	file: Blob,
	name: string,
	secret: string
): Promise<{ key: string; url: string; name: string; size: number; type: string } | null> {
	const ext = FILE_TYPES[file.type];
	if (!ext || file.size === 0 || file.size > MAX_FILE_BYTES) return null;
	const key = `${uid}/${crypto.randomUUID()}.${ext}`;
	await bucket.put(key, await file.arrayBuffer(), {
		httpMetadata: { contentType: file.type, cacheControl: 'public, max-age=31536000, immutable' }
	});
	const exp = Date.now() + 86_400_000;
	const sig = await sign_key(secret, key, exp);
	return { key, url: signed_media_url(key, exp, sig), name, size: file.size, type: file.type };
}

export async function get_image(bucket: MediaBucket, key: string): Promise<MediaObject | null> {
	return (await bucket.get(key)) ?? null;
}

/** only the uploader may delete — ownership is encoded in the key prefix */
export async function delete_image(
	bucket: MediaBucket,
	uid: string,
	key: string
): Promise<boolean> {
	if (!key.startsWith(`${uid}/`)) return false;
	await bucket.delete(key);
	return true;
}
