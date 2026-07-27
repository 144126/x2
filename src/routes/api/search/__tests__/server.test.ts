import { describe, it, expect, vi, beforeEach } from 'vitest';

const { ensureMock, searchMock, embedMock } = vi.hoisted(() => ({
	ensureMock: vi.fn(),
	searchMock: vi.fn(),
	embedMock: vi.fn()
}));

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$lib/server/qdrant', async () => {
	const actual = await vi.importActual<typeof import('../../../../lib/server/qdrant')>(
		'../../../../lib/server/qdrant'
	);
	return { ...actual, ensure: ensureMock, search: searchMock };
});
vi.mock('$lib/server/or', () => ({ embed: embedMock }));

import { GET } from '../+server';

function make_event(qs: string, uid = 'me') {
	return {
		url: new URL(`https://x/api/search?${qs}`),
		locals: { user: uid ? { id: uid, name: 'Me' } : null }
	} as Parameters<typeof GET>[0];
}

beforeEach(() => {
	vi.clearAllMocks();
	ensureMock.mockResolvedValue(undefined);
	embedMock.mockResolvedValue([0.1, 0.2]);
	searchMock.mockResolvedValue([]);
});

describe('GET /api/search', () => {
	it('401s when not logged in', async () => {
		await expect(GET(make_event('q=hi', ''))).rejects.toMatchObject({ status: 401 });
	});

	it('400s without a query', async () => {
		await expect(GET(make_event(''))).rejects.toMatchObject({ status: 400 });
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
});
