import { describe, it, expect, vi, beforeEach } from 'vitest';

const { ensureMock, upsertMock, scrollMock, removeMock } = vi.hoisted(() => ({
	ensureMock: vi.fn(),
	upsertMock: vi.fn(),
	scrollMock: vi.fn(),
	removeMock: vi.fn()
}));

vi.mock('../qdrant', async () => {
	const actual = await vi.importActual<typeof import('../qdrant')>('../qdrant');
	return { ...actual, ensure: ensureMock, upsert: upsertMock, scroll: scrollMock, remove: removeMock };
});

import type { QEnv } from '../qdrant';
import { mute, unmute, is_muted, is_active, muters_of, drop_muted, muted_convs, type Mute } from '../mute';
import { conv_id, group_conv_id } from '../chat';

const ENV = { QDRANT_URL: 'u', QDRANT_KEY: 'k' } as unknown as QEnv;

beforeEach(() => {
	vi.clearAllMocks();
	ensureMock.mockResolvedValue(undefined);
	upsertMock.mockResolvedValue(undefined);
	scrollMock.mockResolvedValue([]);
	removeMock.mockResolvedValue(undefined);
});

describe('mute()', () => {
	it('writes a mute owned by the caller, targeting the given user', async () => {
		await mute(ENV, 'ada', 'bob', 'u');
		const payload = upsertMock.mock.calls[0][1][0].payload;
		expect(payload).toMatchObject({ s: 'mu', ow: 'ada', tg: 'bob', k: 'u', until: 0 });
	});

	it('writes a room mute with kind r', async () => {
		await mute(ENV, 'ada', 'r1', 'r');
		const payload = upsertMock.mock.calls[0][1][0].payload;
		expect(payload.k).toBe('r');
	});

	it('uses a deterministic UUID id, so re-muting overwrites instead of duplicating', async () => {
		await mute(ENV, 'ada', 'bob', 'u');
		const id1 = upsertMock.mock.calls[0][1][0].id;
		expect(id1).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

		await mute(ENV, 'ada', 'bob', 'u');
		const id2 = upsertMock.mock.calls[1][1][0].id;
		expect(id2).toBe(id1);
	});

	it('stores an absolute expiry when one is given', async () => {
		await mute(ENV, 'ada', 'bob', 'u', 5_000);
		const payload = upsertMock.mock.calls[0][1][0].payload;
		expect(payload.until).toBe(5_000);
	});
});

describe('unmute()', () => {
	it('removes exactly the id that mute() wrote', async () => {
		await mute(ENV, 'ada', 'bob', 'u');
		const id = upsertMock.mock.calls[0][1][0].id;
		vi.clearAllMocks();
		ensureMock.mockResolvedValue(undefined);
		removeMock.mockResolvedValue(undefined);

		await unmute(ENV, 'ada', 'bob');
		expect(removeMock).toHaveBeenCalledWith(ENV, [id]);
	});

	it('is a no-op that does not throw when nothing was muted', async () => {
		await expect(unmute(ENV, 'ada', 'nobody')).resolves.toBeUndefined();
	});
});

describe('is_active()', () => {
	it('treats until: 0 as indefinite', () => {
		expect(is_active({ until: 0 } as Mute, 9_999_999)).toBe(true);
	});

	it('is active while until is in the future', () => {
		expect(is_active({ until: 100 } as Mute, 50)).toBe(true);
	});

	it('is not active once until has passed', () => {
		expect(is_active({ until: 100 } as Mute, 200)).toBe(false);
	});
});

describe('is_muted()', () => {
	it('is true for a live mute', async () => {
		scrollMock.mockResolvedValue([
			{ payload: { s: 'mu', ow: 'ada', tg: 'bob', k: 'u', until: 0, d: 1 } }
		]);
		expect(await is_muted(ENV, 'ada', 'bob')).toBe(true);
	});

	it('is false when the mute has expired', async () => {
		scrollMock.mockResolvedValue([
			{ payload: { s: 'mu', ow: 'ada', tg: 'bob', k: 'u', until: 100, d: 1 } }
		]);
		expect(await is_muted(ENV, 'ada', 'bob', 200)).toBe(false);
	});

	it('is false when nothing is stored', async () => {
		expect(await is_muted(ENV, 'ada', 'nobody')).toBe(false);
	});

	it('filters by owner AND target, so one user muting bob does not mute bob for everyone', async () => {
		await is_muted(ENV, 'ada', 'bob');
		const filter = scrollMock.mock.calls[0][1] as { must: { key: string; match: { value: string } }[] };
		const keys = filter.must.map((c) => ({ key: c.key, value: c.match.value }));
		expect(keys).toContainEqual({ key: 's', value: 'mu' });
		expect(keys).toContainEqual({ key: 'ow', value: 'ada' });
		expect(keys).toContainEqual({ key: 'tg', value: 'bob' });
	});
});

describe('muters_of() / drop_muted()', () => {
	it('returns only the uids from the candidate list that muted the target', async () => {
		scrollMock.mockResolvedValue([
			{ payload: { s: 'mu', ow: 'ada', tg: 'r1', k: 'r', until: 0, d: 1 } },
			{ payload: { s: 'mu', ow: 'bob', tg: 'r1', k: 'r', until: 0, d: 1 } },
			{ payload: { s: 'mu', ow: 'zed', tg: 'r1', k: 'r', until: 0, d: 1 } }
		]);
		const result = await muters_of(ENV, 'r1', ['ada', 'cid']);
		expect(result).toEqual(new Set(['ada']));
	});

	it('drops expired mutes', async () => {
		scrollMock.mockResolvedValue([
			{ payload: { s: 'mu', ow: 'ada', tg: 'r1', k: 'r', until: 50, d: 1 } }
		]);
		const result = await muters_of(ENV, 'r1', ['ada'], 100);
		expect(result).toEqual(new Set());
	});

	it('issues one query for the whole room, not one per member', async () => {
		scrollMock.mockResolvedValue([]);
		await muters_of(ENV, 'r1', Array(50).fill('x'));
		expect(scrollMock.mock.calls.length).toBe(1);
	});

	it('returns an empty set for an empty uid list without querying', async () => {
		const result = await muters_of(ENV, 'r1', []);
		expect(result).toEqual(new Set());
		expect(scrollMock).not.toHaveBeenCalled();
	});

	it('drop_muted returns the unmuted uids in their original order', async () => {
		scrollMock.mockResolvedValue([
			{ payload: { s: 'mu', ow: 'bob', tg: 'r1', k: 'r', until: 0, d: 1 } }
		]);
		const result = await drop_muted(ENV, 'r1', ['ada', 'bob', 'cid']);
		expect(result).toEqual(['ada', 'cid']);
	});
});

describe('muted_convs()', () => {
	it('maps a user mute to the sorted 1:1 conversation id', () => {
		const m: Mute = { s: 'mu', ow: 'ada', tg: 'bob', k: 'u', until: 0, d: 1 };
		expect(muted_convs('ada', [m])).toEqual([conv_id('ada', 'bob')]);
	});

	it('maps a room mute to the g: conversation id', () => {
		const m: Mute = { s: 'mu', ow: 'ada', tg: 'r1', k: 'r', until: 0, d: 1 };
		expect(muted_convs('ada', [m])).toEqual([group_conv_id('r1')]);
	});
});

describe('payload/filter coherence', () => {
	it('writes every payload key that the read filters later match on', async () => {
		await mute(ENV, 'ada', 'bob', 'u');
		const payload = upsertMock.mock.calls[0][1][0].payload;

		scrollMock.mockResolvedValue([]);
		await is_muted(ENV, 'ada', 'bob');
		const filter = scrollMock.mock.calls[0][1] as { must: { key: string; match: { value: string } }[] };

		for (const cond of filter.must) {
			expect(payload).toHaveProperty(cond.key, cond.match.value);
		}
	});
});
