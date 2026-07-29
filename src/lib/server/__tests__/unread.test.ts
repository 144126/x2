import { describe, it, expect, vi, beforeEach } from 'vitest';

const { ensureMock, upsertMock, scrollMock, listMutesMock } = vi.hoisted(() => ({
	ensureMock: vi.fn(),
	upsertMock: vi.fn(),
	scrollMock: vi.fn(),
	listMutesMock: vi.fn()
}));

vi.mock('../qdrant', async () => {
	const actual = await vi.importActual<typeof import('../qdrant')>('../qdrant');
	return { ...actual, ensure: ensureMock, upsert: upsertMock, scroll: scrollMock };
});

vi.mock('../mute', () => ({ list_mutes: listMutesMock, muted_convs: () => [] }));

import type { QEnv } from '../qdrant';
import { ZV, uuid_from } from '../qdrant';
import { mark_read, read_id, total_unread, unread_by_conv } from '../unread';

const env = {} as QEnv;

const msg = (o: { c: string; f: string; t?: string; d: number; gr?: string }) => ({
	id: `m${o.d}`,
	payload: { s: 'm', id: `m${o.d}`, x: 'hi', t: '', ...o }
});
const read = async (c: string, d: number) => ({
	id: await read_id('me', c),
	payload: { s: 'rd', f: 'me', c, d }
});

// scroll is called with a filter; route each call by what it asks for
function route(sets: { msgs?: unknown[]; reads?: unknown[]; groups?: unknown[] }) {
	scrollMock.mockImplementation(
		(_e: unknown, filter: { must: { key: string; match?: { value: string } }[] }) => {
			const kind = filter.must.find((c) => c.key === 's')?.match?.value;
			if (kind === 'rd') return Promise.resolve(sets.reads ?? []);
			const conv = filter.must.find((c) => c.key === 'c')?.match?.value;
			const all = (conv ? sets.groups : sets.msgs) ?? [];
			return Promise.resolve(
				conv ? all.filter((m) => (m as { payload: { c: string } }).payload.c === conv) : all
			);
		}
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	ensureMock.mockResolvedValue(undefined);
	upsertMock.mockResolvedValue(undefined);
	scrollMock.mockResolvedValue([]);
	listMutesMock.mockResolvedValue([]);
});

describe('read_id', () => {
	it('returns a UUID, the only string form Qdrant accepts as a point id', async () => {
		expect(await read_id('me', 'a|b')).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
		);
	});

	it('is deterministic per user and conversation, so marking read upserts', async () => {
		expect(await read_id('me', 'a|b')).toBe(await read_id('me', 'a|b'));
	});

	it('is scoped to the user — two people read the same thread independently', async () => {
		expect(await read_id('me', 'a|b')).not.toBe(await read_id('you', 'a|b'));
	});

	it('is scoped to the conversation', async () => {
		expect(await read_id('me', 'a|b')).not.toBe(await read_id('me', 'a|c'));
	});
});

describe('mark_read', () => {
	it('stores a read marker for the conversation', async () => {
		await mark_read(env, 'me', 'a|b', 500);
		const point = upsertMock.mock.calls[0][1][0];
		expect(point.id).toBe(await read_id('me', 'a|b'));
		expect(point.payload).toMatchObject({ s: 'rd', f: 'me', c: 'a|b', d: 500 });
	});

	it('writes the read marker with a zero vector from the shared ZV constant', async () => {
		await mark_read(env, 'me', 'a|b', 500);
		const point = upsertMock.mock.calls[0][1][0];
		expect(point.vector).toBe(ZV);
	});

	it('defaults the marker to now', async () => {
		const before = Date.now();
		await mark_read(env, 'me', 'a|b');
		expect(upsertMock.mock.calls[0][1][0].payload.d).toBeGreaterThanOrEqual(before);
	});

	it('never moves a marker backwards', async () => {
		route({ reads: [await read('a|b', 900)] });
		await mark_read(env, 'me', 'a|b', 500);
		expect(upsertMock.mock.calls[0][1][0].payload.d).toBe(900);
	});
});

describe('unread_by_conv', () => {
	it('counts every received message when the thread was never opened', async () => {
		route({
			msgs: [msg({ c: 'a|me', f: 'a', t: 'me', d: 1 }), msg({ c: 'a|me', f: 'a', t: 'me', d: 2 })]
		});
		expect(await unread_by_conv(env, 'me')).toEqual({ 'a|me': 2 });
	});

	it('counts only messages newer than the read marker', async () => {
		route({
			msgs: [
				msg({ c: 'a|me', f: 'a', t: 'me', d: 100 }),
				msg({ c: 'a|me', f: 'a', t: 'me', d: 300 })
			],
			reads: [await read('a|me', 200)]
		});
		expect(await unread_by_conv(env, 'me')).toEqual({ 'a|me': 1 });
	});

	it("never counts the reader's own messages", async () => {
		route({ msgs: [msg({ c: 'a|me', f: 'me', t: 'a', d: 1 })] });
		expect(await unread_by_conv(env, 'me')).toEqual({});
	});

	it('omits a fully-read conversation rather than reporting zero', async () => {
		route({
			msgs: [msg({ c: 'a|me', f: 'a', t: 'me', d: 100 })],
			reads: [await read('a|me', 200)]
		});
		expect(await unread_by_conv(env, 'me')).toEqual({});
	});

	it('keeps conversations separate', async () => {
		route({
			msgs: [
				msg({ c: 'a|me', f: 'a', t: 'me', d: 1 }),
				msg({ c: 'b|me', f: 'b', t: 'me', d: 2 }),
				msg({ c: 'b|me', f: 'b', t: 'me', d: 3 })
			]
		});
		expect(await unread_by_conv(env, 'me')).toEqual({ 'a|me': 1, 'b|me': 2 });
	});

	it('counts group messages for the conversations it is told about', async () => {
		route({
			groups: [msg({ c: 'g:1', f: 'a', gr: '1', d: 5 }), msg({ c: 'g:1', f: 'b', gr: '1', d: 6 })]
		});
		expect(await unread_by_conv(env, 'me', ['g:1'])).toEqual({ 'g:1': 2 });
	});

	it("does not count the reader's own group messages", async () => {
		route({ groups: [msg({ c: 'g:1', f: 'me', gr: '1', d: 5 })] });
		expect(await unread_by_conv(env, 'me', ['g:1'])).toEqual({});
	});

	it('respects a group read marker', async () => {
		route({
			groups: [msg({ c: 'g:1', f: 'a', gr: '1', d: 5 }), msg({ c: 'g:1', f: 'a', gr: '1', d: 50 })],
			reads: [await read('g:1', 10)]
		});
		expect(await unread_by_conv(env, 'me', ['g:1'])).toEqual({ 'g:1': 1 });
	});

	it('is empty for a user with nothing waiting', async () => {
		expect(await unread_by_conv(env, 'me')).toEqual({});
	});
});

describe('total_unread', () => {
	it('sums every conversation, which is what the app badge shows', async () => {
		route({
			msgs: [
				msg({ c: 'a|me', f: 'a', t: 'me', d: 1 }),
				msg({ c: 'b|me', f: 'b', t: 'me', d: 2 }),
				msg({ c: 'b|me', f: 'b', t: 'me', d: 3 })
			]
		});
		expect(await total_unread(env, 'me')).toBe(3);
	});

	it('is zero when nothing is waiting, so the badge clears', async () => {
		expect(await total_unread(env, 'me')).toBe(0);
	});

	it('unread_by_conv still counts a muted conversation', async () => {
		route({
			msgs: [msg({ c: 'a|me', f: 'a', t: 'me', d: 1 })],
			reads: []
		});
		listMutesMock.mockResolvedValue([{ s: 'mu', ow: 'me', tg: 'a', k: 'u', until: 0, d: 1 }]);
		const by_conv = await unread_by_conv(env, 'me');
		expect(by_conv).toEqual({ 'a|me': 1 });
	});

	it('total_unread excludes a muted 1:1 conversation', async () => {
		route({
			msgs: [msg({ c: 'a|me', f: 'a', t: 'me', d: 1 })],
			reads: []
		});
		listMutesMock.mockResolvedValue([{ s: 'mu', ow: 'me', tg: 'a', k: 'u', until: 0, d: 1 }]);
		expect(await total_unread(env, 'me')).toBe(0);
	});

	it('total_unread excludes a muted room', async () => {
		route({ groups: [msg({ c: 'g:1', f: 'b', gr: '1', d: 5 })] });
		listMutesMock.mockResolvedValue([{ s: 'mu', ow: 'me', tg: '1', k: 'r', until: 0, d: 1 }]);
		expect(await total_unread(env, 'me', ['g:1'])).toBe(0);
	});

	it('total_unread counts everything when nothing is muted', async () => {
		route({
			msgs: [msg({ c: 'a|me', f: 'a', t: 'me', d: 1 })],
			reads: []
		});
		listMutesMock.mockResolvedValue([]);
		expect(await total_unread(env, 'me')).toBe(1);
	});

	it('counts a conversation again once its mute has expired', async () => {
		route({
			msgs: [msg({ c: 'a|me', f: 'a', t: 'me', d: 1 })],
			reads: []
		});
		// list_mutes filters expired mutes internally — an expired mute returns empty
		listMutesMock.mockResolvedValue([]);
		expect(await total_unread(env, 'me')).toBe(1);
	});
});
