import { describe, it, expect, vi, beforeEach } from 'vitest';

const { ensureMock, upsertMock, retrieveOneMock, scrollMock, searchMock, embedMock } = vi.hoisted(
	() => ({
		ensureMock: vi.fn(),
		upsertMock: vi.fn(),
		retrieveOneMock: vi.fn(),
		scrollMock: vi.fn(),
		searchMock: vi.fn(),
		embedMock: vi.fn()
	})
);

vi.mock('../qdrant', async () => {
	const actual = await vi.importActual<typeof import('../qdrant')>('../qdrant');
	return {
		...actual,
		ensure: ensureMock,
		upsert: upsertMock,
		retrieve_one: retrieveOneMock,
		scroll: scrollMock,
		search: searchMock
	};
});
vi.mock('../or', () => ({ embed: embedMock }));

import {
	save_group,
	get_group,
	update_group,
	delete_group,
	join_group,
	leave_group,
	list_groups,
	search_groups,
	is_member,
	shared_groups
} from '../group';

const ENV = { QDRANT_URL: 'u', QDRANT_KEY: 'k' };
const VEC = new Array(4096).fill(0.1);
const stored = (call = 0) => upsertMock.mock.calls[call][1][0];

beforeEach(() => {
	vi.clearAllMocks();
	ensureMock.mockResolvedValue(undefined);
	upsertMock.mockResolvedValue(undefined);
	retrieveOneMock.mockResolvedValue(null);
	scrollMock.mockResolvedValue([]);
	searchMock.mockResolvedValue([]);
	embedMock.mockResolvedValue(VEC);
});

const group = (over: Record<string, unknown> = {}) => ({
	id: 'g1',
	payload: {
		s: 'g',
		id: 'g1',
		nm: 'Ceramics',
		ds: 'wheel-thrown pots',
		ow: 'owner1',
		mb: ['owner1'],
		d: 100,
		...over
	}
});

describe('save_group', () => {
	it('stores the group with the owner as its first member', async () => {
		const g = await save_group(ENV, 'owner1', { name: 'Ceramics', description: 'pots' });
		expect(g.name).toBe('Ceramics');
		expect(g.owner).toBe('owner1');
		expect(g.members).toEqual(['owner1']);
		expect(stored().payload).toMatchObject({ s: 'g', nm: 'Ceramics', ds: 'pots', ow: 'owner1' });
	});

	it('embeds name + description only — that is the whole search signal', async () => {
		await save_group(ENV, 'owner1', { name: 'Ceramics', description: 'wheel-thrown pots' });
		expect(embedMock).toHaveBeenCalledWith(
			ENV,
			'group_name: Ceramics | group_about: wheel-thrown pots'
		);
		expect(stored().vector).toBe(VEC);
	});

	it('rejects a blank name', async () => {
		await expect(save_group(ENV, 'owner1', { name: '  ' })).rejects.toThrow('name_required');
	});

	it('saves a room with a country, state and city', async () => {
		const g = await save_group(ENV, 'owner1', {
			name: 'Accra Pottery',
			description: '',
			country: 'GH',
			state: 'AA',
			city: 'Accra'
		});
		expect(stored().payload).toMatchObject({ co: 'GH', st: 'AA', ci: 'Accra' });
	});

	it('saves a room with no location at all', async () => {
		const g = await save_group(ENV, 'owner1', { name: 'Online', description: '' });
		expect(stored().payload.co).toBeUndefined();
	});

	it('exposes country, state and city on the view', async () => {
		const g = await save_group(ENV, 'owner1', {
			name: 'Accra Pottery',
			description: '',
			country: 'GH',
			state: 'AA',
			city: 'Accra'
		});
		expect(g).toMatchObject({ country: 'GH', state: 'AA', city: 'Accra' });
	});

	it('does not fold the location into the embedding', async () => {
		await save_group(ENV, 'owner1', { name: 'Ceramics', description: 'pots', country: 'GH' });
		expect(embedMock).toHaveBeenCalledWith(ENV, 'group_name: Ceramics | group_about: pots');
	});
});

describe('get_group', () => {
	it('returns null for a record that is not a group', async () => {
		retrieveOneMock.mockResolvedValue({ id: 'g1', payload: { s: 'm' } });
		expect(await get_group(ENV, 'g1')).toBeNull();
	});

	it('maps stored keys to the view shape', async () => {
		retrieveOneMock.mockResolvedValue(group());
		expect(await get_group(ENV, 'g1')).toEqual({
			id: 'g1',
			name: 'Ceramics',
			description: 'wheel-thrown pots',
			owner: 'owner1',
			members: ['owner1'],
			created: 100
		});
	});
});

describe('update_group', () => {
	it('re-embeds on edit, since search matches on name + description', async () => {
		retrieveOneMock.mockResolvedValue(group());
		const g = await update_group(ENV, 'g1', 'owner1', { name: 'Pottery' });
		expect(g?.name).toBe('Pottery');
		expect(embedMock).toHaveBeenCalledWith(
			ENV,
			'group_name: Pottery | group_about: wheel-thrown pots'
		);
	});

	it('refuses a non-owner and writes nothing', async () => {
		retrieveOneMock.mockResolvedValue(group());
		expect(await update_group(ENV, 'g1', 'someone_else', { name: 'Hijacked' })).toBeNull();
		expect(upsertMock).not.toHaveBeenCalled();
	});

	it('updates a location on an existing room', async () => {
		retrieveOneMock.mockResolvedValue(group());
		const g = await update_group(ENV, 'g1', 'owner1', { country: 'GH' });
		expect(upsertMock.mock.calls[0][1][0].payload).toMatchObject({ co: 'GH' });
	});

	it('clears a location when given an empty string', async () => {
		retrieveOneMock.mockResolvedValue(group({ co: 'GH' }));
		const g = await update_group(ENV, 'g1', 'owner1', { country: '' });
		expect(upsertMock.mock.calls[0][1][0].payload.co).toBe('');
	});

	it('leaves a location alone when the field is undefined', async () => {
		retrieveOneMock.mockResolvedValue(group({ co: 'GH' }));
		const g = await update_group(ENV, 'g1', 'owner1', {});
		expect(upsertMock.mock.calls[0][1][0].payload.co).toBe('GH');
	});
});

describe('membership', () => {
	it('adds a joiner once, and is idempotent', async () => {
		retrieveOneMock.mockResolvedValue(group());
		expect((await join_group(ENV, 'g1', 'bob'))?.members).toEqual(['owner1', 'bob']);

		retrieveOneMock.mockResolvedValue(group({ mb: ['owner1', 'bob'] }));
		expect((await join_group(ENV, 'g1', 'bob'))?.members).toEqual(['owner1', 'bob']);
		expect(upsertMock).toHaveBeenCalledTimes(1); // second join wrote nothing
	});

	it('lets a member leave but never the owner', async () => {
		retrieveOneMock.mockResolvedValue(group({ mb: ['owner1', 'bob'] }));
		expect((await leave_group(ENV, 'g1', 'bob'))?.members).toEqual(['owner1']);
		expect(await leave_group(ENV, 'g1', 'owner1')).toBeNull();
	});

	it('is_member reflects the member list', () => {
		const g = {
			id: 'g1',
			name: 'n',
			description: '',
			owner: 'o',
			members: ['o', 'bob'],
			created: 1
		};
		expect(is_member(g, 'bob')).toBe(true);
		expect(is_member(g, 'eve')).toBe(false);
	});
});

describe('delete_group', () => {
	it('refuses a non-owner', async () => {
		retrieveOneMock.mockResolvedValue(group());
		expect(await delete_group(ENV, 'g1', 'eve')).toBe(false);
	});
});

describe('list_groups / search_groups', () => {
	it('lists newest first', async () => {
		scrollMock.mockResolvedValue([group({ d: 100 }), group({ id: 'g2', d: 900 })]);
		expect((await list_groups(ENV, 'owner1')).map((g) => g.created)).toEqual([900, 100]);
	});

	it('ranks by score when an embedding is available', async () => {
		searchMock.mockResolvedValue([{ ...group(), score: 0.8 }]);
		const r = await search_groups(ENV, 'pots');
		expect(r[0].score).toBe(0.8);
		expect(embedMock).toHaveBeenCalledWith(ENV, 'pots');
	});

	it('falls back to listing when no embedder is configured', async () => {
		const { ZV } = await vi.importActual<typeof import('../qdrant')>('../qdrant');
		embedMock.mockResolvedValue(ZV);
		scrollMock.mockResolvedValue([group()]);
		expect(await search_groups(ENV, 'pots')).toHaveLength(1);
		expect(searchMock).not.toHaveBeenCalled();
	});

	it('filters by country', async () => {
		scrollMock.mockResolvedValue([group()]);
		await search_groups(ENV, '', { country: 'GH' });
		const filter = scrollMock.mock.calls[0][1];
		expect(filter.must).toContainEqual({ key: 'co', match: { value: 'GH' } });
	});

	it('filters by country and state together', async () => {
		scrollMock.mockResolvedValue([group()]);
		await search_groups(ENV, '', { country: 'GH', state: 'AA' });
		const filter = scrollMock.mock.calls[0][1];
		expect(filter.must).toContainEqual({ key: 'co', match: { value: 'GH' } });
		expect(filter.must).toContainEqual({ key: 'st', match: { value: 'AA' } });
	});

	it('filters by city', async () => {
		scrollMock.mockResolvedValue([group()]);
		await search_groups(ENV, '', { city: 'Accra' });
		const filter = scrollMock.mock.calls[0][1];
		expect(filter.must).toContainEqual({ key: 'ci', match: { value: 'Accra' } });
	});

	it('applies the filters when there is no query', async () => {
		scrollMock.mockResolvedValue([group()]);
		await search_groups(ENV, '', { country: 'GH' });
		expect(scrollMock).toHaveBeenCalled();
		expect(searchMock).not.toHaveBeenCalled();
	});

	it('applies the filters when the embedder returns a zero vector', async () => {
		const { ZV } = await vi.importActual<typeof import('../qdrant')>('../qdrant');
		embedMock.mockResolvedValue(ZV);
		scrollMock.mockResolvedValue([group()]);
		await search_groups(ENV, 'pots', { country: 'GH' });
		expect(scrollMock).toHaveBeenCalled();
	});

	it('sorts the no-query fallback newest first', async () => {
		scrollMock.mockResolvedValue([group({ d: 100 }), group({ id: 'g2', d: 900 })]);
		const r = await search_groups(ENV, '', {});
		expect(r.map((g) => g.created)).toEqual([900, 100]);
	});

	it('returns scored results when a query is given', async () => {
		searchMock.mockResolvedValue([{ ...group({}), score: 0.8 }]);
		const r = await search_groups(ENV, 'pots', {});
		expect(r[0].score).toBe(0.8);
	});
});

describe('shared_groups', () => {
	it('returns groups both users belong to', async () => {
		scrollMock
			.mockResolvedValueOnce([
				group({ id: 'g1', mb: ['a', 'b'] }),
				group({ id: 'g2', mb: ['a', 'c'] })
			])
			.mockResolvedValueOnce([
				group({ id: 'g1', mb: ['a', 'b'] }),
				group({ id: 'g3', mb: ['b', 'd'] })
			]);
		const shared = await shared_groups(ENV, 'a', 'b');
		expect(shared.map((g) => g.id)).toEqual(['g1']);
	});

	it('returns an empty list when there is no overlap', async () => {
		scrollMock
			.mockResolvedValueOnce([group({ id: 'g1', mb: ['a'] })])
			.mockResolvedValueOnce([group({ id: 'g2', mb: ['b'] })]);
		expect(await shared_groups(ENV, 'a', 'b')).toEqual([]);
	});

	it('returns every group for a user compared with themself', async () => {
		scrollMock
			.mockResolvedValueOnce([group({ id: 'g1', mb: ['a'] })])
			.mockResolvedValueOnce([group({ id: 'g1', mb: ['a'] })]);
		expect((await shared_groups(ENV, 'a', 'a')).map((g) => g.id)).toEqual(['g1']);
	});
});
