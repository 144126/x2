import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getUserMock, patchUserMock } = vi.hoisted(() => ({
	getUserMock: vi.fn(),
	patchUserMock: vi.fn()
}));

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$lib/server/user', () => ({ get_user: getUserMock, patch_user: patchUserMock }));

import { GET, POST, DELETE } from '../+server';

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
