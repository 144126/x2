import { describe, it, expect, vi, beforeEach } from 'vitest';

const { ensureMock, upsertMock, retrieveOneMock, scrollMock, searchMock, embedMock, idState } =
	vi.hoisted(() => ({
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
vi.mock('../msg_crypto', () => ({
	encrypt_text: async (_env: unknown, text: string) => `enc:${text}`,
	decrypt_text: async (_env: unknown, stored: string) =>
		stored.startsWith('enc:') ? stored.slice(4) : stored
}));

import {
	conv_id,
	group_conv_id,
	send_msg,
	send_group_msg,
	edit_msg,
	get_messages,
	get_group_messages,
	get_message,
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
	it('stores the message with no vector at all (embedding deferred to backfill)', async () => {
		const m = await send_msg(ENV, 'alice', 'bob', 'hi there');
		expect(ensureMock).toHaveBeenCalledWith(ENV);
		expect(embedMock).not.toHaveBeenCalled();
		expect(m).toEqual({
			s: 'm',
			id: 'id-1',
			c: 'alice|bob',
			f: 'alice',
			t: 'bob',
			x: 'hi there',
			d: expect.any(Number)
		});
		expect(upsertMock).toHaveBeenCalledWith(ENV, [
			{ id: 'id-1', vector: {}, payload: { ...m, x: 'enc:hi there' } }
		]);
	});

	it('stores short messages with no vector (no embed at send time)', async () => {
		const m = await send_msg(ENV, 'alice', 'bob', 'ok');
		expect(embedMock).not.toHaveBeenCalled();
		expect(upsertMock).toHaveBeenCalledWith(ENV, [
			{ id: m.id, vector: {}, payload: { ...m, x: 'enc:ok' } }
		]);
	});

	it('stores a reply_to reference as rp on the message', async () => {
		const m = await send_msg(ENV, 'alice', 'bob', 'thanks', undefined, undefined, 'orig-1');
		expect(m.rp).toBe('orig-1');
		expect(upsertMock).toHaveBeenCalledWith(ENV, [
			{ id: m.id, vector: {}, payload: { ...m, x: 'enc:thanks' } }
		]);
	});

	it('omits rp when no reply_to is given', async () => {
		const m = await send_msg(ENV, 'alice', 'bob', 'hi');
		expect(m).not.toHaveProperty('rp');
	});
});

describe('send_group_msg', () => {
	it('stores the group message with no vector either', async () => {
		const m = await send_group_msg(ENV, 'alice', 'g1', 'hi room');
		expect(upsertMock).toHaveBeenCalledWith(ENV, [
			{ id: m.id, vector: {}, payload: { ...m, x: 'enc:hi room' } }
		]);
	});

	it('stores a reply_to reference as rp on a group message too', async () => {
		const m = await send_group_msg(ENV, 'alice', 'g1', 'me too', undefined, undefined, 'orig-2');
		expect(m.rp).toBe('orig-2');
		expect(upsertMock).toHaveBeenCalledWith(ENV, [
			{ id: m.id, vector: {}, payload: { ...m, x: 'enc:me too' } }
		]);
	});
});

describe('edit_msg', () => {
	it('preserves a point with no vector rather than reintroducing one', async () => {
		retrieveOneMock.mockResolvedValue({
			id: 'm1',
			vector: {},
			payload: { s: 'm', id: 'm1', f: 'alice', c: 'alice|bob', t: 'bob', x: 'old', d: 1 }
		});
		await edit_msg(ENV, 'alice', 'm1', 'new text');
		expect(upsertMock.mock.calls[0][1][0].vector).toEqual({});
	});

	it('preserves an existing named vector on edit', async () => {
		retrieveOneMock.mockResolvedValue({
			id: 'm1',
			vector: { t: [1, 2, 3] },
			payload: { s: 'm', id: 'm1', f: 'alice', c: 'alice|bob', t: 'bob', x: 'old', d: 1 }
		});
		await edit_msg(ENV, 'alice', 'm1', 'new text');
		expect(upsertMock.mock.calls[0][1][0].vector).toEqual({ t: [1, 2, 3] });
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
	it('fetches the newest 50 ordered desc by `d`, then re-sorts ascending', async () => {
		scrollMock.mockResolvedValue([
			{ id: '2', payload: { s: 'm', c: 'a|b', f: 'b', t: 'a', x: 'second', d: 200 } },
			{ id: '1', payload: { s: 'm', c: 'a|b', f: 'a', t: 'b', x: 'first', d: 100 } }
		]);
		const msgs = await get_messages(ENV, 'a', 'b');
		expect(scrollMock).toHaveBeenCalledWith(ENV, f(eq('s', 'm'), eq('c', 'a|b')), 50, undefined, {
			key: 'd',
			direction: 'desc'
		});
		expect(msgs.map((m) => m.x)).toEqual(['first', 'second']);
	});

	it('pages older messages via start_from = before - 1', async () => {
		scrollMock.mockResolvedValue([]);
		await get_messages(ENV, 'a', 'b', 100);
		expect(scrollMock).toHaveBeenCalledWith(ENV, f(eq('s', 'm'), eq('c', 'a|b')), 50, undefined, {
			key: 'd',
			direction: 'desc',
			start_from: 99
		});
	});
});

describe('get_group_messages', () => {
	it('fetches the newest 50 ordered desc by `d`, then re-sorts ascending', async () => {
		scrollMock.mockResolvedValue([
			{ id: '2', payload: { s: 'm', c: group_conv_id('g1'), gr: 'g1', f: 'b', x: 'second', d: 200 } },
			{ id: '1', payload: { s: 'm', c: group_conv_id('g1'), gr: 'g1', f: 'a', x: 'first', d: 100 } }
		]);
		const msgs = await get_group_messages(ENV, 'g1');
		expect(scrollMock).toHaveBeenCalledWith(
			ENV,
			f(eq('s', 'm'), eq('c', group_conv_id('g1'))),
			50,
			undefined,
			{ key: 'd', direction: 'desc' }
		);
		expect(msgs.map((m) => m.x)).toEqual(['first', 'second']);
	});

	it('pages older messages via start_from = before - 1', async () => {
		scrollMock.mockResolvedValue([]);
		await get_group_messages(ENV, 'g1', 100);
		expect(scrollMock).toHaveBeenCalledWith(
			ENV,
			f(eq('s', 'm'), eq('c', group_conv_id('g1'))),
			50,
			undefined,
			{ key: 'd', direction: 'desc', start_from: 99 }
		);
	});
});

describe('get_message', () => {
	it('returns null when the point is missing', async () => {
		retrieveOneMock.mockResolvedValue(null);
		expect(await get_message(ENV, 'm1')).toBeNull();
	});

	it('returns null for a point with the wrong discriminator', async () => {
		retrieveOneMock.mockResolvedValue({ id: 'm1', payload: { s: 'u', n: 'x' } });
		expect(await get_message(ENV, 'm1')).toBeNull();
	});

	it('returns the decrypted message for a message point', async () => {
		retrieveOneMock.mockResolvedValue({
			id: 'm1',
			payload: { id: 'm1', s: 'm', c: 'a|b', f: 'a', t: 'b', x: 'enc:hello', d: 100 }
		});
		expect(await get_message(ENV, 'm1')).toMatchObject({ id: 'm1', x: 'hello', d: 100 });
	});
});



describe('get_user_name', () => {
	it('returns the username (not full name)', async () => {
		retrieveOneMock.mockResolvedValue({
			id: 'uid',
			payload: { s: 'u', n: 'Ada Lovelace', u: 'ada' }
		});
		expect(await get_user_name(ENV, 'uid')).toBe('ada');
	});

	it('falls back to the uid when the user cannot be found', async () => {
		retrieveOneMock.mockResolvedValue(null);
		expect(await get_user_name(ENV, 'ghost-uid')).toBe('ghost-uid');
	});

	it('shows username in chat header instead of full name', async () => {
		retrieveOneMock.mockResolvedValue({
			id: 'uid',
			payload: { s: 'u', n: 'Ada Lovelace', u: 'ada_lovelace' }
		});
		expect(await get_user_name(ENV, 'uid')).toBe('ada_lovelace');
	});
});
