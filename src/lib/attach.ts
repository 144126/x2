export type UploadResult = {
	key?: string;
	name?: string;
	size?: number;
	type?: string;
	error?: string;
};

export type UploadHandle = { promise: Promise<UploadResult>; abort: () => void };

/**
 * POST one file to R2 via /api/upload, reporting progress as it goes.
 *
 * XMLHttpRequest rather than fetch: fetch still has no upload progress event, and a file
 * moving with no sign of it is the whole complaint this replaces.
 */
export function upload(
	file: File | Blob,
	opts: { view_once?: boolean; onprogress?: (pct: number) => void } = {}
): UploadHandle {
	const xhr = new XMLHttpRequest();
	const body = new FormData();
	body.append('file', file);

	const promise = new Promise<UploadResult>((resolve) => {
		xhr.upload.onprogress = (e) => {
			if (e.lengthComputable) opts.onprogress?.(Math.round((e.loaded / e.total) * 100));
		};
		xhr.onload = () => {
			if (xhr.status < 200 || xhr.status >= 300) {
				resolve({ error: xhr.responseText || 'upload failed' });
				return;
			}
			try {
				resolve(JSON.parse(xhr.responseText) as UploadResult);
			} catch {
				resolve({ error: 'upload failed' });
			}
		};
		xhr.onerror = () => resolve({ error: 'upload failed' });
		xhr.onabort = () => resolve({ error: 'cancelled' });
		xhr.open('POST', opts.view_once ? '/api/upload?vo=1' : '/api/upload');
		xhr.send(body);
	});

	return { promise, abort: () => xhr.abort() };
}

export const media_src = (key: string): string => `/media/${key}`;

/** first image on a paste/drop event, if any */
export function image_from_event(e: ClipboardEvent | DragEvent): File | null {
	const items = 'clipboardData' in e ? e.clipboardData?.files : e.dataTransfer?.files;
	const f = items?.[0];
	return f && f.type.startsWith('image/') ? f : null;
}
