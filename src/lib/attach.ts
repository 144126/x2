/** POST one image to R2 via /api/upload. Returns the media key, or an error string. */
export async function upload_image(file: File | Blob): Promise<{ key?: string; error?: string }> {
	const body = new FormData();
	body.append('file', file);
	const res = await fetch('/api/upload', { method: 'POST', body });
	if (!res.ok) return { error: (await res.text().catch(() => '')) || 'upload failed' };
	const { key } = (await res.json()) as { key: string };
	return { key };
}

/** POST one non-image file to R2 via /api/upload. Returns the saved file record, or an error string. */
export async function upload_file(
	file: File
): Promise<{ key?: string; name?: string; size?: number; type?: string; error?: string }> {
	const body = new FormData();
	body.append('file', file);
	const res = await fetch('/api/upload', { method: 'POST', body });
	if (!res.ok) return { error: (await res.text().catch(() => '')) || 'upload failed' };
	return res.json();
}

export const media_src = (key: string): string => `/media/${key}`;

/** first image on a paste/drop event, if any */
export function image_from_event(e: ClipboardEvent | DragEvent): File | null {
	const items = 'clipboardData' in e ? e.clipboardData?.files : e.dataTransfer?.files;
	const f = items?.[0];
	return f && f.type.startsWith('image/') ? f : null;
}
