import { describe, it, expect, vi, beforeEach } from 'vitest';

const { ensureMock, upsertMock, retrieveOneMock, scrollMock, searchMock, embedMock, idState } = vi.hoisted(() => ({
	ensureMock: vi.fn(),
	upsertMock: vi.fn(),
	retrieveOneMock: vi.fn(),
	scrollMock: vi.fn(),
	searchMock: vi.fn(),
	embedMock: vi.fn(),
	idState: { n: 0 }
}));

vi.mock('../qdrant', async () => {
	const actual = await vi.importActual<typeof import('../qdrant')>('../qdrant');
	return {
		...actual,
		ensure: ensureMock,
		upsert: upsertMock,
		retrieve_one: retrieveOneMock,
		scroll: scrollMock,
		search: searchMock,
		new_id: () => `id-${++idState.n}`
	};
});
vi.mock('../or', () => ({ embed: embedMock }));

import {
	conv_id,
	send_msg,
	get_messages,
	list_conversations,
	get_user_name,
	search_messages
} from '../chat';
import { ZV, f, f_or, eq } from '../qdrant';

const ENV = { QDRANT_URL: 'u', QDRANT_KEY: 'k' };

beforeEach(() => {
	vi.clearAllMocks();
	idState.n = 0;
	ensureMock.mockResolvedValue(undefined);
	upsertMock.mockResolvedValue(undefined);
	embedMock.mockResolvedValue(ZV);
	searchMock.mockResolvedValue([]);
});

describe('conv_id', () => {
	it('is order-independent (sorted join)', () => {
		expect(conv_id('a', 'b')).toBe(conv_id('b', 'a'));
		expect(conv_id('a', 'b')).toBe('a|b');
	});

	it('produces a distinct id per pair', () => {
		expect(conv_id('a', 'b')).not.toBe(conv_id('a', 'c'));
	});
});

describe('send_msg', () => {
	it('embeds the message text and stores it, returning the message', async () => {
		embedMock.mockResolvedValue([1, 0, 0]);
		const m = await send_msg(ENV, 'alice', 'bob', 'hi there');
		expect(ensureMock).toHaveBeenCalledWith(ENV);
		expect(embedMock).toHaveBeenCalledWith(ENV, 'hi there');
		expect(m).toEqual({
			s: 'm',
			id: 'id-1',
			c: 'alice|bob',
			f: 'alice',
			t: 'bob',
			x: 'hi there',
			d: expect.any(Number)
		});
		expect(upsertMock).toHaveBeenCalledWith(ENV, [{ id: 'id-1', vector: [1, 0, 0], payload: m }]);
	});

	it('skips embedding for trivially short messages', async () => {
		const m = await send_msg(ENV, 'alice', 'bob', 'ok');
		expect(embedMock).not.toHaveBeenCalled();
		expect(upsertMock).toHaveBeenCalledWith(ENV, [{ id: m.id, vector: ZV, payload: m }]);
	});
});

describe('search_messages', () => {
	it('searches by embedding, restricted to sender-or-recipient when no conv given', async () => {
		embedMock.mockResolvedValue([9, 9, 9]);
		searchMock.mockResolvedValue([{ id: '1', payload: { s: 'm', x: 'found it' } }]);
		const r = await search_messages(ENV, 'ada', 'query text');
		expect(embedMock).toHaveBeenCalledWith(ENV, 'query text');
		expect(searchMock).toHaveBeenCalledWith(
			ENV,
			[9, 9, 9],
			f_or([eq('s', 'm')], [eq('f', 'ada'), eq('t', 'ada')]),
			20
		);
		expect(r.map((m) => m.x)).toEqual(['found it']);
	});

	it('scopes to a single conversation when `conv` is given', async () => {
		await search_messages(ENV, 'ada', 'query', 'ada|bob');
		expect(searchMock).toHaveBeenCalledWith(ENV, ZV, f(eq('s', 'm'), eq('c', 'ada|bob')), 20);
	});
});

describe('get_messages', () => {
	it('filters by conversation id and sorts ascending by time', async () => {
		scrollMock.mockResolvedValue([
			{ id: '2', payload: { s: 'm', c: 'a|b', f: 'b', t: 'a', x: 'second', d: 200 } },
			{ id: '1', payload: { s: 'm', c: 'a|b', f: 'a', t: 'b', x: 'first', d: 100 } }
		]);
		const msgs = await get_messages(ENV, 'a', 'b');
		expect(scrollMock).toHaveBeenCalledWith(ENV, f(eq('s', 'm'), eq('c', 'a|b')), 500);
		expect(msgs.map((m) => m.x)).toEqual(['first', 'second']);
	});
});

describe('list_conversations', () => {
	it('picks the latest message per peer from sent+received, sorted by recency', async () => {
		scrollMock
			.mockResolvedValueOnce([
				// sent by uid
				{ id: '1', payload: { s: 'm', f: 'uid', t: 'peer1', x: 'old sent', d: 100 } },
				{ id: '2', payload: { s: 'm', f: 'uid', t: 'peer2', x: 'to peer2', d: 300 } }
			])
			.mockResolvedValueOnce([
				// received by uid
				{ id: '3', payload: { s: 'm', f: 'peer1', t: 'uid', x: 'newer from peer1', d: 500 } }
			])
			.mockResolvedValueOnce([]) // matched_a
			.mockResolvedValueOnce([]); // matched_b
		const convs = await list_conversations(ENV, 'uid');
		expect(convs).toEqual([
			{ peer: 'peer1', last: 500, preview: 'newer from peer1' },
			{ peer: 'peer2', last: 300, preview: 'to peer2' }
		]);
	});

	it('returns an empty list when there are no messages or matches', async () => {
		scrollMock.mockResolvedValue([]);
		expect(await list_conversations(ENV, 'uid')).toEqual([]);
	});

	it('shows a matched-but-unmessaged peer with a placeholder preview', async () => {
		scrollMock
			.mockResolvedValueOnce([]) // sent
			.mockResolvedValueOnce([]) // recv
			.mockResolvedValueOnce([{ id: 'm1', payload: { s: 'x', f: 'uid', t: 'stranger', d: 111 } }])
			.mockResolvedValueOnce([]); // matched_b
		const convs = await list_conversations(ENV, 'uid');
		expect(convs).toEqual([{ peer: 'stranger', last: 111, preview: 'you matched — say hi!' }]);
	});

	it('lets a real message override the match placeholder once one exists', async () => {
		scrollMock
			.mockResolvedValueOnce([
				{ id: 'm1', payload: { s: 'm', f: 'uid', t: 'stranger', x: 'hey!', d: 999 } }
			]) // sent
			.mockResolvedValueOnce([]) // recv
			.mockResolvedValueOnce([{ id: 'x1', payload: { s: 'x', f: 'uid', t: 'stranger', d: 111 } }])
			.mockResolvedValueOnce([]); // matched_b
		const convs = await list_conversations(ENV, 'uid');
		expect(convs).toEqual([{ peer: 'stranger', last: 999, preview: 'hey!' }]);
	});
});

describe('get_user_name', () => {
	it('returns the username (not full name)', async () => {
		retrieveOneMock.mockResolvedValue({ id: 'uid', payload: { s: 'u', n: 'Ada Lovelace', u: 'ada' } });
		expect(await get_user_name(ENV, 'uid')).toBe('ada');
	});

	it('falls back to the uid when the user cannot be found', async () => {
		retrieveOneMock.mockResolvedValue(null);
		expect(await get_user_name(ENV, 'ghost-uid')).toBe('ghost-uid');
	});

	it('shows username in chat header instead of full name', async () => {
		retrieveOneMock.mockResolvedValue({ id: 'uid', payload: { s: 'u', n: 'Ada Lovelace', u: 'ada_lovelace' } });
		expect(await get_user_name(ENV, 'uid')).toBe('ada_lovelace');
	});
});