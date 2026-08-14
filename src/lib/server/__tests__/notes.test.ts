import { describe, it, expect, vi, beforeEach } from 'vitest';

const { scrollMock, upsertMock, removeMock, retrieveManyMock, getUserMock, patchUserMock } =
	vi.hoisted(() => ({
		scrollMock: vi.fn(),
		upsertMock: vi.fn(),
		removeMock: vi.fn(),
		retrieveManyMock: vi.fn(),
		getUserMock: vi.fn(),
		patchUserMock: vi.fn()
	}));

vi.mock('../qdrant', async () => {
	const actual = await vi.importActual<typeof import('../qdrant')>('../qdrant');
	return {
		...actual,
		ensure: async () => {},
		scroll: scrollMock,
		upsert: upsertMock,
		remove: removeMock,
		retrieve_many: retrieveManyMock
	};
});
vi.mock('../user', () => ({ get_user: getUserMock, patch_user: patchUserMock }));

import { add_note, next_note, mark_heard, NOTE_TTL, MAX_THREADS, POOL_FLOOR } from '../notes';

const env = { QDRANT_URL: 'u', QDRANT_KEY: 'k' };
const note = (over: Record<string, unknown> = {}) => ({
	payload: {
		s: 'vn',
		id: 'n1',
		f: 'bob',
		k: 'bob/a.webm',
		pr: '2026-08-14',
		th: 0,
		d: Date.now(),
		...over
	}
});

beforeEach(() => {
	vi.clearAllMocks();
	getUserMock.mockResolvedValue({ s: 'u', u: 'ada' });
	scrollMock.mockResolvedValue([]);
});

describe('add_note', () => {
	it('keeps one open note per person per prompt', async () => {
		scrollMock.mockResolvedValue([{ id: 'old-point', payload: {} }]);
		await add_note(env, 'ada', 'ada/new.webm', '2026-08-14');
		expect(removeMock).toHaveBeenCalledWith(env, ['old-point']);
		expect(upsertMock).toHaveBeenCalledTimes(1);
	});
});

describe('next_note', () => {
	it('never replays something this listener already heard', async () => {
		getUserMock.mockResolvedValue({ s: 'u', u: 'ada', hn: ['n1'] });
		scrollMock.mockResolvedValue([note()]);
		expect(await next_note(env, 'ada')).toBeNull();
	});

	it('serves the newest unheard note', async () => {
		scrollMock.mockResolvedValue([
			note({ id: 'older', d: Date.now() - 10_000 }),
			note({ id: 'newer', d: Date.now() })
		]);
		expect((await next_note(env, 'ada'))?.id).toBe('newer');
	});

	it('retires a note that has already started enough conversations', async () => {
		scrollMock.mockResolvedValue([note({ th: MAX_THREADS })]);
		expect(await next_note(env, 'ada')).toBeNull();
	});

	it('keeps playing week-old notes rather than letting the pool empty', async () => {
		// a hard delete on day seven takes the whole seeded pool out at once
		scrollMock.mockResolvedValue([note({ d: Date.now() - NOTE_TTL - 1000 })]);
		expect(await next_note(env, 'ada')).not.toBeNull();
	});

	it('prefers fresh notes once the pool is deep enough to afford it', async () => {
		const fresh = Array.from({ length: POOL_FLOOR }, (_, i) =>
			note({ id: `f${i}`, d: Date.now() - i })
		);
		const stale = note({ id: 'stale', d: Date.now() - NOTE_TTL - 1000 });
		scrollMock.mockResolvedValue([stale, ...fresh]);
		const got = await next_note(env, 'ada');
		expect(got?.id).not.toBe('stale');
	});
});

describe('mark_heard', () => {
	it('remembers it without duplicating', async () => {
		getUserMock.mockResolvedValue({ s: 'u', u: 'ada', hn: ['n1', 'n2'] });
		await mark_heard(env, 'ada', 'n2');
		expect(patchUserMock).toHaveBeenCalledWith(env, 'ada', { hn: ['n2', 'n1'] });
	});
});
