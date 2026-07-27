import { describe, it, expect, vi, beforeEach } from 'vitest';

const { ensureMock, upsertMock, retrieveOneMock, scrollMock, idState } = vi.hoisted(() => ({
	ensureMock: vi.fn(),
	upsertMock: vi.fn(),
	retrieveOneMock: vi.fn(),
	scrollMock: vi.fn(),
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
		new_id: () => `id-${++idState.n}`
	};
});

import { conv_id, send_msg, get_messages, list_conversations, get_user_name, record_match } from '../chat';
import { ZV, f, eq } from '../qdrant';

const ENV = { QDRANT_URL: 'u', QDRANT_KEY: 'k' };

beforeEach(() => {
	vi.clearAllMocks();
	idState.n = 0;
	ensureMock.mockResolvedValue(undefined);
	upsertMock.mockResolvedValue(undefined);
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
	it('builds and stores a message with a zero vector, returning it', async () => {
		const m = await send_msg(ENV, 'alice', 'bob', 'hi there');
		expect(ensureMock).toHaveBeenCalledWith(ENV);
		expect(m).toEqual({
			s: 'm',
			id: 'id-1',
			c: 'alice|bob',
			f: 'alice',
			t: 'bob',
			x: 'hi there',
			d: expect.any(Number)
		});
		expect(upsertMock).toHaveBeenCalledWith(ENV, [{ id: 'id-1', vector: ZV, payload: m }]);
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

describe('record_match', () => {
	it('upserts a match record keyed by the conversation id, reusing the f/t schema', async () => {
		await record_match(ENV, 'alice', 'bob');
		expect(ensureMock).toHaveBeenCalledWith(ENV);
		expect(upsertMock).toHaveBeenCalledWith(ENV, [
			{
				id: 'match:alice|bob',
				vector: ZV,
				payload: { s: 'x', f: 'alice', t: 'bob', d: expect.any(Number) }
			}
		]);
	});
});

describe('get_user_name', () => {
	it('returns the stored display name', async () => {
		retrieveOneMock.mockResolvedValue({ id: 'uid', payload: { s: 'u', n: 'Ada' } });
		expect(await get_user_name(ENV, 'uid')).toBe('Ada');
	});

	it('falls back to the uid when the user cannot be found', async () => {
		retrieveOneMock.mockResolvedValue(null);
		expect(await get_user_name(ENV, 'ghost-uid')).toBe('ghost-uid');
	});
});
