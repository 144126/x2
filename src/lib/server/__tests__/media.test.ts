import { describe, it, expect, vi } from 'vitest';
import {
	put_image,
	put_file,
	delete_image,
	media_url,
	sign_key,
	MAX_BYTES,
	MAX_FILE_BYTES
} from '../media';

const bucket = () => ({
	put: vi.fn().mockResolvedValue(undefined),
	get: vi.fn().mockResolvedValue(null),
	delete: vi.fn().mockResolvedValue(undefined)
});

// Blob.size is real; type drives the extension
const img = (type: string, bytes = 10) => new Blob([new Uint8Array(bytes)], { type });

describe('sign_key', () => {
	it('is stable for the same key + exp + secret', async () => {
		const a = await sign_key('s3kr1t', 'u/file.jpg', 1_800_000_000_000);
		const b = await sign_key('s3kr1t', 'u/file.jpg', 1_800_000_000_000);
		expect(a).toBe(b);
	});

	it('differs when the key changes', async () => {
		const a = await sign_key('s3kr1t', 'u/file1.jpg', 1_800_000_000_000);
		const b = await sign_key('s3kr1t', 'u/file2.jpg', 1_800_000_000_000);
		expect(a).not.toBe(b);
	});

	it('differs when exp changes', async () => {
		const a = await sign_key('s3kr1t', 'u/file.jpg', 1_800_000_000_000);
		const b = await sign_key('s3kr1t', 'u/file.jpg', 1_800_000_000_001);
		expect(a).not.toBe(b);
	});

	it('returns a short hex string (32 chars)', async () => {
		const s = await sign_key('s3kr1t', 'u/file.jpg', 1_800_000_000_000);
		expect(s).toMatch(/^[0-9a-f]{32}$/);
	});
});

describe('put_image', () => {
	it('keys uploads under the uploader and keeps the extension, returns a signed URL', async () => {
		const b = bucket();
		const saved = await put_image(b as never, 'user123', img('image/jpeg'), 'test-secret');
		expect(saved?.key.startsWith('user123/')).toBe(true);
		expect(saved?.key.endsWith('.jpg')).toBe(true);
		expect(saved?.url).toMatch(/^\/media\/user123\/.+\.jpg\?e=\d+&s=[0-9a-f]{32}$/);
		expect(b.put).toHaveBeenCalledTimes(1);
	});

	it('gives every upload its own key', async () => {
		const b = bucket();
		const a = await put_image(b as never, 'u', img('image/png'), 's');
		const c = await put_image(b as never, 'u', img('image/png'), 's');
		expect(a?.key).not.toBe(c?.key);
	});

	it('rejects non-images, empty files and oversized files without writing', async () => {
		const b = bucket();
		expect(await put_image(b as never, 'u', img('application/pdf'), 's')).toBeNull();
		expect(await put_image(b as never, 'u', img('image/png', 0), 's')).toBeNull();
		expect(await put_image(b as never, 'u', img('image/png', MAX_BYTES + 1), 's')).toBeNull();
		expect(b.put).not.toHaveBeenCalled();
	});
});

describe('put_file', () => {
	it('accepts allow-listed document types and keeps the original filename, returns a signed URL', async () => {
		const b = bucket();
		const saved = await put_file(
			b as never,
			'user123',
			img('application/pdf'),
			'resume.pdf',
			'test-secret'
		);
		expect(saved?.key.startsWith('user123/')).toBe(true);
		expect(saved?.key.endsWith('.pdf')).toBe(true);
		expect(saved?.name).toBe('resume.pdf');
		expect(saved?.url).toMatch(/^\/media\/user123\/.+\.pdf\?e=\d+&s=[0-9a-f]{32}$/);
		expect(b.put).toHaveBeenCalledTimes(1);
	});

	it('rejects types outside the allow-list, empty files and oversized files', async () => {
		const b = bucket();
		expect(await put_file(b as never, 'u', img('application/x-executable'), 'f', 's')).toBeNull();
		expect(await put_file(b as never, 'u', img('application/pdf', 0), 'f', 's')).toBeNull();
		expect(
			await put_file(b as never, 'u', img('application/pdf', MAX_FILE_BYTES + 1), 'f', 's')
		).toBeNull();
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
