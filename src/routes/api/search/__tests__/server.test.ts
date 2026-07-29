import { describe, it, expect, vi, beforeEach } from 'vitest';

const { ensureMock, searchMock, scrollMock, embedMock, getSecretMock } = vi.hoisted(() => ({
	ensureMock: vi.fn(),
	searchMock: vi.fn(),
	scrollMock: vi.fn(),
	embedMock: vi.fn(),
	getSecretMock: vi.fn()
}));

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$lib/server/qdrant', async () => {
	const actual = await vi.importActual<typeof import('../../../../lib/server/qdrant')>(
		'../../../../lib/server/qdrant'
	);
	return {
		...actual,
		ensure: ensureMock,
		search: searchMock,
		scroll: scrollMock,
		get_secret: getSecretMock
	};
});
vi.mock('$lib/server/or', () => ({ embed: embedMock }));

import { GET } from '../+server';

function make_event(qs: string, uid = 'me') {
	return {
		url: new URL(`https://x/api/search?${qs}`),
		locals: {
			user: uid ? { id: uid, name: 'Me' } : null,
			x2_ws: {
				fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify({ online: [] })))
			}
		}
	} as unknown as Parameters<typeof GET>[0];
}

beforeEach(() => {
	vi.clearAllMocks();
	ensureMock.mockResolvedValue(undefined);
	embedMock.mockResolvedValue([0.1, 0.2]);
	searchMock.mockResolvedValue([]);
	scrollMock.mockResolvedValue([]);
	getSecretMock.mockResolvedValue('s');
});

describe('GET /api/search', () => {
	it('401s when not logged in', async () => {
		await expect(GET(make_event('q=hi', ''))).rejects.toMatchObject({ status: 401 });
	});

	it('scrolls the filters when no query is given', async () => {
		scrollMock.mockResolvedValue([{ id: 'u1', payload: { s: 'u', n: 'U1' } }]);
		const res = await GET(make_event('gender=f'));
		const body = await res.json();
		expect(body.r).toHaveLength(1);
		expect(scrollMock).toHaveBeenCalled();
	});

	it('returns all users for a completely empty search instead of 400', async () => {
		scrollMock.mockResolvedValue([{ id: 'u1', payload: { s: 'u', n: 'U1' } }]);
		const res = await GET(make_event(''));
		expect(res.status).toBe(200);
		expect(scrollMock).toHaveBeenCalled();
		const filter = scrollMock.mock.calls[0][1];
		expect(filter).toEqual({ must: [{ key: 's', match: { value: 'u' } }] });
	});

	it('falls back to a scroll when the embedder returns a zero vector', async () => {
		embedMock.mockResolvedValue([0, 0]);
		scrollMock.mockResolvedValue([{ id: 'u1', payload: { s: 'u', n: 'U1' } }]);
		const res = await GET(make_event('q=hiking'));
		const body = await res.json();
		expect(body.r).toHaveLength(1);
	});

	it('searches by vector when a query is given', async () => {
		await GET(make_event('q=hiking'));
		expect(searchMock).toHaveBeenCalled();
	});

	it('always filters to user profiles (s=u)', async () => {
		await GET(make_event('q=hiking'));
		const filter = searchMock.mock.calls[0][2];
		expect(filter.must).toContainEqual({ key: 's', match: { value: 'u' } });
	});

	it('adds a gender condition when provided', async () => {
		await GET(make_event('q=hiking&gender=f'));
		const filter = searchMock.mock.calls[0][2];
		expect(filter.must).toContainEqual({ key: 'r', match: { value: 'f' } });
	});

	it('adds country/state conditions when provided', async () => {
		await GET(make_event('q=hiking&country=US&state=CA'));
		const filter = searchMock.mock.calls[0][2];
		expect(filter.must).toContainEqual({ key: 'co', match: { value: 'US' } });
		expect(filter.must).toContainEqual({ key: 'st', match: { value: 'CA' } });
	});

	it('adds an age range condition when either bound is provided', async () => {
		await GET(make_event('q=hiking&age_min=21&age_max=35'));
		const filter = searchMock.mock.calls[0][2];
		expect(filter.must).toContainEqual({ key: 'ag', range: { gte: 21, lte: 35 } });
	});

	it('supports an open-ended age range (min only)', async () => {
		await GET(make_event('q=hiking&age_min=21'));
		const filter = searchMock.mock.calls[0][2];
		expect(filter.must).toContainEqual({ key: 'ag', range: { gte: 21 } });
	});

	it('omits the age condition entirely when neither bound is provided', async () => {
		await GET(make_event('q=hiking'));
		const filter = searchMock.mock.calls[0][2];
		expect(filter.must.some((c: { key: string }) => c.key === 'ag')).toBe(false);
	});

	it('filters the caller out of their own search results', async () => {
		searchMock.mockResolvedValue([
			{ id: 'me', payload: { s: 'u', n: 'Me' }, score: 1 },
			{ id: 'other', payload: { s: 'u', n: 'Other' }, score: 0.9 }
		]);
		const res = await GET(make_event('q=hiking'));
		const body = await res.json();
		expect(body.r.map((x: { id: string }) => x.id)).toEqual(['other']);
	});

	it('maps location fields through into results', async () => {
		searchMock.mockResolvedValue([
			{ id: 'other', payload: { s: 'u', n: 'Other', co: 'US', st: 'CA', ci: 'SF' }, score: 0.5 }
		]);
		const res = await GET(make_event('q=hiking'));
		const body = await res.json();
		expect(body.r[0]).toMatchObject({ co: 'US', st: 'CA', ci: 'SF' });
	});

	it('pages through candidates until it has 20 online users', async () => {
		scrollMock
			.mockResolvedValueOnce(
				Array.from({ length: 100 }, (_, i) => ({ id: `u${i}`, payload: { s: 'u', n: `U${i}` } }))
			)
			.mockResolvedValueOnce(
				Array.from({ length: 100 }, (_, i) => ({ id: `v${i}`, payload: { s: 'u', n: `V${i}` } }))
			);
		const ev = make_event('online=1');
		const ws = ev.locals.x2_ws as { fetch: ReturnType<typeof vi.fn> };
		ws.fetch.mockResolvedValue(
			new Response(
				JSON.stringify({
					online: [
						'u1',
						'u2',
						'u3',
						'v1',
						'v2',
						'v3',
						'v4',
						'v5',
						'v6',
						'v7',
						'v8',
						'v9',
						'v10',
						'v11',
						'v12',
						'v13',
						'v14',
						'v15',
						'v16',
						'v17',
						'v18',
						'v19',
						'v20'
					]
				})
			)
		);
		const res = await GET(ev);
		const body = await res.json();
		expect(body.r).toHaveLength(20);
	});

	it('requests at most 100 uids per presence check', async () => {
		scrollMock.mockResolvedValue(
			Array.from({ length: 100 }, (_, i) => ({ id: `u${i}`, payload: { s: 'u', n: `U${i}` } }))
		);
		const ev = make_event('online=1');
		const ws = ev.locals.x2_ws as { fetch: ReturnType<typeof vi.fn> };
		ws.fetch.mockResolvedValue(
			new Response(JSON.stringify({ online: Array.from({ length: 100 }, (_, i) => `u${i}`) }))
		);
		await GET(ev);
		const callBody = JSON.parse(ws.fetch.mock.calls[0][1].body);
		expect(callBody.uids.length).toBeLessThanOrEqual(100);
	});

	it('stops after three pages rather than scanning forever', async () => {
		scrollMock.mockResolvedValue(
			Array.from({ length: 100 }, (_, i) => ({ id: `u${i}`, payload: { s: 'u', n: `U${i}` } }))
		);
		const ev = make_event('online=1');
		const ws = ev.locals.x2_ws as { fetch: ReturnType<typeof vi.fn> };
		ws.fetch.mockResolvedValue(new Response(JSON.stringify({ online: ['u1'] })));
		await GET(ev);
		expect(scrollMock.mock.calls.length).toBeLessThanOrEqual(3);
	});

	it('stops early when a page comes back short', async () => {
		scrollMock.mockResolvedValueOnce(
			Array.from({ length: 30 }, (_, i) => ({ id: `u${i}`, payload: { s: 'u', n: `U${i}` } }))
		);
		const ev = make_event('online=1');
		const ws = ev.locals.x2_ws as { fetch: ReturnType<typeof vi.fn> };
		ws.fetch.mockResolvedValue(new Response(JSON.stringify({ online: ['u1'] })));
		await GET(ev);
		expect(scrollMock).toHaveBeenCalledTimes(1);
	});

	it('does not paginate when the online filter is off', async () => {
		searchMock.mockResolvedValue(
			Array.from({ length: 30 }, (_, i) => ({
				id: `u${i}`,
				payload: { s: 'u', n: `U${i}` },
				score: 0.5
			}))
		);
		await GET(make_event('q=hiking'));
		expect(searchMock).toHaveBeenCalledTimes(1);
	});

	it('returns everyone with filtered:false when presence is unreachable', async () => {
		scrollMock.mockResolvedValue([{ id: 'u1', payload: { s: 'u', n: 'U1' } }]);
		const ev = make_event('online=1');
		const ws = ev.locals.x2_ws as { fetch: ReturnType<typeof vi.fn> };
		ws.fetch.mockRejectedValue(new Error('timeout'));
		const res = await GET(ev);
		const body = await res.json();
		expect(body.filtered).toBe(false);
		expect(body.r).toHaveLength(1);
	});

	it('returns everyone with filtered:false when presence responds with a non-array', async () => {
		scrollMock.mockResolvedValue([{ id: 'u1', payload: { s: 'u', n: 'U1' } }]);
		const ev = make_event('online=1');
		const ws = ev.locals.x2_ws as { fetch: ReturnType<typeof vi.fn> };
		ws.fetch.mockResolvedValue(new Response(JSON.stringify({ online: 'nope' })));
		const res = await GET(ev);
		const body = await res.json();
		expect(body.filtered).toBe(false);
		expect(body.r).toHaveLength(1);
	});

	it('returns everyone with filtered:false on a non-200 from the presence oracle', async () => {
		scrollMock.mockResolvedValue([{ id: 'u1', payload: { s: 'u', n: 'U1' } }]);
		const ev = make_event('online=1');
		const ws = ev.locals.x2_ws as { fetch: ReturnType<typeof vi.fn> };
		ws.fetch.mockResolvedValue(new Response('bad', { status: 400 }));
		const res = await GET(ev);
		const body = await res.json();
		expect(body.filtered).toBe(false);
		expect(body.r).toHaveLength(1);
	});

	it('reports filtered:true when the check genuinely returned nobody', async () => {
		scrollMock.mockResolvedValue([{ id: 'u1', payload: { s: 'u', n: 'U1' } }]);
		const ev = make_event('online=1');
		const ws = ev.locals.x2_ws as { fetch: ReturnType<typeof vi.fn> };
		ws.fetch.mockResolvedValue(new Response(JSON.stringify({ online: [] })));
		const res = await GET(ev);
		const body = await res.json();
		expect(body.filtered).toBe(true);
		expect(body.r).toHaveLength(0);
	});

	it('marks rows online when the online filter is on', async () => {
		scrollMock.mockResolvedValue([{ id: 'u1', payload: { s: 'u', n: 'U1' } }]);
		const ev = make_event('online=1');
		const ws = ev.locals.x2_ws as { fetch: ReturnType<typeof vi.fn> };
		ws.fetch.mockResolvedValue(new Response(JSON.stringify({ online: ['u1'] })));
		const res = await GET(ev);
		const body = await res.json();
		expect(body.r[0]).toMatchObject({ online: true });
	});

	it('omits the score for scroll results', async () => {
		scrollMock.mockResolvedValue([{ id: 'u1', payload: { s: 'u', n: 'U1' } }]);
		const res = await GET(make_event('gender=m'));
		const body = await res.json();
		expect(body.r[0].s).toBeUndefined();
	});
});
