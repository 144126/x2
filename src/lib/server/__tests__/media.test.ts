import { describe, it, expect, vi } from 'vitest';
import { put_image, put_file, delete_image, media_url, MAX_BYTES, MAX_FILE_BYTES } from '../media';

const bucket = () => ({
	put: vi.fn().mockResolvedValue(undefined),
	get: vi.fn().mockResolvedValue(null),
	delete: vi.fn().mockResolvedValue(undefined)
});

// Blob.size is real; type drives the extension
const img = (type: string, bytes = 10) => new Blob([new Uint8Array(bytes)], { type });

describe('put_image', () => {
	it('keys uploads under the uploader and keeps the extension', async () => {
		const b = bucket();
		const saved = await put_image(b as never, 'user123', img('image/jpeg'));
		expect(saved?.key.startsWith('user123/')).toBe(true);
		expect(saved?.key.endsWith('.jpg')).toBe(true);
		expect(saved?.url).toBe(media_url(saved!.key));
		expect(b.put).toHaveBeenCalledTimes(1);
	});

	it('gives every upload its own key', async () => {
		const b = bucket();
		const a = await put_image(b as never, 'u', img('image/png'));
		const c = await put_image(b as never, 'u', img('image/png'));
		expect(a?.key).not.toBe(c?.key);
	});

	it('rejects non-images, empty files and oversized files without writing', async () => {
		const b = bucket();
		expect(await put_image(b as never, 'u', img('application/pdf'))).toBeNull();
		expect(await put_image(b as never, 'u', img('image/png', 0))).toBeNull();
		expect(await put_image(b as never, 'u', img('image/png', MAX_BYTES + 1))).toBeNull();
		expect(b.put).not.toHaveBeenCalled();
	});
});

describe('put_file', () => {
	it('accepts allow-listed document types and keeps the original filename', async () => {
		const b = bucket();
		const saved = await put_file(b as never, 'user123', img('application/pdf'), 'resume.pdf');
		expect(saved?.key.startsWith('user123/')).toBe(true);
		expect(saved?.key.endsWith('.pdf')).toBe(true);
		expect(saved?.name).toBe('resume.pdf');
		expect(b.put).toHaveBeenCalledTimes(1);
	});

	it('rejects types outside the allow-list, empty files and oversized files', async () => {
		const b = bucket();
		expect(await put_file(b as never, 'u', img('application/x-executable'))).toBeNull();
		expect(await put_file(b as never, 'u', img('application/pdf', 0))).toBeNull();
		expect(await put_file(b as never, 'u', img('application/pdf', MAX_FILE_BYTES + 1))).toBeNull();
		expect(b.put).not.toHaveBeenCalled();
	});
});

describe('delete_image', () => {
	it('only lets the uploader delete their own key', async () => {
		const b = bucket();
		expect(await delete_image(b as never, 'eve', 'user123/x.png')).toBe(false);
		expect(b.delete).not.toHaveBeenCalled();
		expect(await delete_image(b as never, 'user123', 'user123/x.png')).toBe(true);
		expect(b.delete).toHaveBeenCalledWith('user123/x.png');
	});
});
