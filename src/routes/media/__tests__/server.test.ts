import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$env/dynamic/private', () => ({ env: { SECRET: 'test-secret' } }));

const { getImageMock } = vi.hoisted(() => ({ getImageMock: vi.fn() }));
vi.mock('$lib/server/media', async () => {
	const actual = await vi.importActual<typeof import('$lib/server/media')>('$lib/server/media');
	return { ...actual, get_image: getImageMock };
});

import { GET } from '../[...key]/+server';

const bucket = {
	get: vi.fn()
};

function obj(body = 'image-data') {
	return {
		body: new ReadableStream({
			start(c) {
				c.enqueue(new TextEncoder().encode(body));
				c.close();
			}
		}),
		httpEtag: '"abc123"',
		writeHttpMetadata(h: Headers) {
			h.set('content-type', 'image/jpeg');
		}
	};
}

function event(
	url: string,
	user: { id: string; username: string } | null = { id: 'u', username: 'u' }
) {
	const u = new URL(`https://x${url}`);
	return {
		params: { key: u.pathname.replace('/media/', '') },
		url: u,
		locals: { user },
		platform: { env: { MEDIA: bucket } }
	} as unknown as Parameters<typeof GET>[0];
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('GET /media/[...key] — signed URL path', () => {
	it('200s with public cache-control when the signature is valid', async () => {
		const { sign_key } = await import('$lib/server/media');
		const exp = Date.now() + 86_400_000;
		const sig = await sign_key('test-secret', 'u/img.jpg', exp);
		getImageMock.mockResolvedValue(obj());
		const res = await GET(event(`/media/u/img.jpg?e=${exp}&s=${sig}`));
		expect(res.status).toBe(200);
		expect(res.headers.get('cache-control')).toBe('public, max-age=86400, immutable');
	});

	it('403s when the signature has expired', async () => {
		const { sign_key } = await import('$lib/server/media');
		const exp = Date.now() - 1000;
		const sig = await sign_key('test-secret', 'u/img.jpg', exp);
		await expect(GET(event(`/media/u/img.jpg?e=${exp}&s=${sig}`))).rejects.toMatchObject({
			status: 403
		});
	});

	it('403s when the signature is tampered', async () => {
		await expect(GET(event('/media/u/img.jpg?e=1800000000000&s=bad'))).rejects.toMatchObject({
			status: 403
		});
	});

	it('403s when the key does not match the signature', async () => {
		const { sign_key } = await import('$lib/server/media');
		const exp = Date.now() + 86_400_000;
		const sig = await sign_key('test-secret', 'u/different.jpg', exp);
		// same sig but different key in the URL
		await expect(GET(event(`/media/u/img.jpg?e=${exp}&s=${sig}`))).rejects.toMatchObject({
			status: 403
		});
	});
});

describe('GET /media/[...key] — unsigned fallback path', () => {
	it('200s when signed in (old private URLs)', async () => {
		getImageMock.mockResolvedValue(obj());
		const res = await GET(event('/media/u/img.jpg'));
		expect(res.status).toBe(200);
	});

	it('401s when signed out', async () => {
		await expect(GET(event('/media/u/img.jpg', null))).rejects.toMatchObject({ status: 401 });
	});
});
