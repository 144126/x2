import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getUserMock, patchUserMock } = vi.hoisted(() => ({
	getUserMock: vi.fn(),
	patchUserMock: vi.fn()
}));

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$lib/server/user', () => ({ get_user: getUserMock, patch_user: patchUserMock }));

import { env } from '$env/dynamic/private';
import { GET, POST, DELETE } from '../+server';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

const klipy = (items: unknown[]) =>
	new Response(JSON.stringify({ result: true, data: { data: items } }), {
		headers: { 'content-type': 'application/json' }
	});

function event(
	method: 'GET' | 'POST' | 'DELETE',
	body?: unknown,
	uid: string | null = 'ada',
	query?: string
) {
	const url = new URL(`https://x/api/stickers${query ? `?${query}` : ''}`);
	return {
		request: new Request(url, {
			method,
			headers: { 'content-type': 'application/json' },
			...(body === undefined ? {} : { body: JSON.stringify(body) })
		}),
		url,
		locals: { user: uid ? { id: uid, username: 'ada' } : null }
	} as unknown as Parameters<typeof POST>[0];
}

beforeEach(() => {
	vi.clearAllMocks();
	getUserMock.mockResolvedValue({ s: 'u', u: 'ada', sp: ['k1', 'k2'] });
	patchUserMock.mockResolvedValue(null);
	delete (env as Record<string, string>).KLIPY_KEY;
});

describe('GET /api/stickers', () => {
	it('401s when signed out', async () => {
		await expect(GET(event('GET', undefined, null))).rejects.toMatchObject({ status: 401 });
	});

	it('returns the caller own pack', async () => {
		expect(await (await GET(event('GET'))).json()).toEqual({ r: ['k1', 'k2'] });
	});

	it('returns an empty pack for someone who has never made one', async () => {
		getUserMock.mockResolvedValue({ s: 'u', u: 'ada' });
		expect(await (await GET(event('GET'))).json()).toEqual({ r: [] });
	});
});

describe('GET /api/stickers?q=', () => {
	it('searches nothing while no klipy key is set', async () => {
		const res = await GET(event('GET', undefined, 'ada', 'q=cat'));
		expect(await res.json()).toEqual({ r: [] });
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('takes the middle rendition of every sticker klipy returns', async () => {
		(env as Record<string, string>).KLIPY_KEY = 'kk';
		fetchMock.mockResolvedValue(
			klipy([
				{
					id: 1,
					type: 'sticker',
					file: {
						hd: { webp: { url: 'https://static.klipy.com/a-hd.webp' } },
						md: { webp: { url: 'https://static.klipy.com/a-md.webp' } },
						sm: { webp: { url: 'https://static.klipy.com/a-sm.webp' } }
					}
				},
				{
					id: 2,
					type: 'sticker',
					file: { sm: { webp: { url: 'https://static2.klipy.com/b-sm.webp' } } }
				}
			])
		);
		const res = await GET(event('GET', undefined, 'ada', 'q=cat'));
		expect(await res.json()).toEqual({
			r: ['https://static.klipy.com/a-md.webp', 'https://static2.klipy.com/b-sm.webp']
		});
		const [url] = fetchMock.mock.calls[0] as [string];
		expect(url).toContain('/kk/stickers/search?q=cat');
		expect(url).toContain('customer_id=ada');
	});

	it('drops a sticker served from anywhere but klipy', async () => {
		(env as Record<string, string>).KLIPY_KEY = 'kk';
		fetchMock.mockResolvedValue(
			klipy([
				{
					id: 3,
					type: 'sticker',
					file: { md: { webp: { url: 'https://evil.example.com/x.webp' } } }
				}
			])
		);
		expect(await (await GET(event('GET', undefined, 'ada', 'q=cat'))).json()).toEqual({ r: [] });
	});

	it('never offers an ad as something to send', async () => {
		(env as Record<string, string>).KLIPY_KEY = 'kk';
		fetchMock.mockResolvedValue(
			klipy([
				{ id: 4, type: 'ad', file: { md: { webp: { url: 'https://static.klipy.com/ad.webp' } } } },
				{
					id: 5,
					type: 'sticker',
					file: { md: { webp: { url: 'https://static.klipy.com/s.webp' } } }
				}
			])
		);
		expect(await (await GET(event('GET', undefined, 'ada', 'q=cat'))).json()).toEqual({
			r: ['https://static.klipy.com/s.webp']
		});
	});

	it('lets a signed-out visitor search, without naming them to klipy', async () => {
		(env as Record<string, string>).KLIPY_KEY = 'kk';
		fetchMock.mockResolvedValue(klipy([]));
		await GET(event('GET', undefined, null, 'q=cat'));
		expect((fetchMock.mock.calls[0] as [string])[0]).not.toContain('customer_id');
	});

	it('returns an empty list when klipy fails', async () => {
		(env as Record<string, string>).KLIPY_KEY = 'kk';
		fetchMock.mockResolvedValue(new Response('nope', { status: 500 }));
		expect(await (await GET(event('GET', undefined, 'ada', 'q=cat'))).json()).toEqual({ r: [] });
	});
});

describe('POST /api/stickers', () => {
	it('401s when signed out', async () => {
		await expect(POST(event('POST', { key: 'k3' }, null))).rejects.toMatchObject({ status: 401 });
	});

	it('400s without a key', async () => {
		await expect(POST(event('POST', {}))).rejects.toMatchObject({ status: 400 });
	});

	it('puts the new sticker first and saves it', async () => {
		const res = await POST(event('POST', { key: 'k3' }));
		expect(await res.json()).toEqual({ r: ['k3', 'k1', 'k2'] });
		expect(patchUserMock).toHaveBeenCalledWith({}, 'ada', { sp: ['k3', 'k1', 'k2'] });
	});

	it('re-adding a sticker moves it to the front instead of duplicating it', async () => {
		const res = await POST(event('POST', { key: 'k2' }));
		expect(await res.json()).toEqual({ r: ['k2', 'k1'] });
	});

	it('caps the pack so it cannot grow forever', async () => {
		getUserMock.mockResolvedValue({
			s: 'u',
			u: 'ada',
			sp: Array.from({ length: 60 }, (_, i) => `old${i}`)
		});
		const res = await POST(event('POST', { key: 'new' }));
		const { r } = (await res.json()) as { r: string[] };
		expect(r).toHaveLength(60);
		expect(r[0]).toBe('new');
		expect(r).not.toContain('old59');
	});
});

describe('DELETE /api/stickers', () => {
	it('400s without a key', async () => {
		await expect(DELETE(event('DELETE'))).rejects.toMatchObject({ status: 400 });
	});

	it('drops just that sticker', async () => {
		const res = await DELETE(event('DELETE', undefined, 'ada', 'key=k1'));
		expect(await res.json()).toEqual({ r: ['k2'] });
		expect(patchUserMock).toHaveBeenCalledWith({}, 'ada', { sp: ['k2'] });
	});
});
