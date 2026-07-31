import { describe, it, expect, vi, beforeEach } from 'vitest';

const { ensureMock, upsertMock, scrollMock, removeMock, getGroupMock, isMemberMock } = vi.hoisted(
	() => ({
		ensureMock: vi.fn(),
		upsertMock: vi.fn(),
		scrollMock: vi.fn(),
		removeMock: vi.fn(),
		getGroupMock: vi.fn(),
		isMemberMock: vi.fn()
	})
);

vi.mock('../qdrant', async () => {
	const actual = await vi.importActual<typeof import('../qdrant')>('../qdrant');
	return {
		...actual,
		ensure: ensureMock,
		upsert: upsertMock,
		scroll: scrollMock,
		remove: removeMock
	};
});
vi.mock('../group', () => ({ get_group: getGroupMock, is_member: isMemberMock }));
vi.mock('../msg_crypto', () => ({
	encrypt_text: async (_env: unknown, text: string) => `enc:${text}`,
	decrypt_text: async (_env: unknown, stored: string) =>
		stored.startsWith('enc:') ? stored.slice(4) : stored
}));

import {
	save_scheduled,
	list_scheduled,
	cancel_scheduled,
	due_scheduled,
	send_scheduled_batch
} from '../scheduled';

const ENV = { QDRANT_URL: 'u', QDRANT_KEY: 'k' };

beforeEach(() => {
	vi.clearAllMocks();
	ensureMock.mockResolvedValue(undefined);
	upsertMock.mockResolvedValue(undefined);
	scrollMock.mockResolvedValue([]);
	removeMock.mockResolvedValue(undefined);
	getGroupMock.mockResolvedValue({ id: 'g1', name: 'Group', members: ['ada', 'bob'] });
	isMemberMock.mockReturnValue(true);
});

describe('save_scheduled / list_scheduled / cancel_scheduled', () => {
	it('saves a 1:1 scheduled message with sent=0', async () => {
		const sm = await save_scheduled(ENV, 'ada', { to: 'bob', text: 'hi', at: 99999 });
		expect(sm.sent).toBe(0);
		expect(upsertMock.mock.calls[0][1][0].payload).toMatchObject({
			s: 'sm',
			f: 'ada',
			to: 'bob',
			text: 'hi',
			at: 99999
		});
	});

	it('writes no vector — a scheduled message row is never searched', async () => {
		await save_scheduled(ENV, 'ada', { to: 'bob', text: 'hi', at: 99999 });
		expect(upsertMock.mock.calls[0][1][0].vector).toEqual({});
	});

	it("lists a user's own pending scheduled messages", async () => {
		scrollMock.mockResolvedValue([
			{ id: '1', payload: { s: 'sm', f: 'ada', to: 'bob', text: 'hi', at: 1, sent: 0 } }
		]);
		const list = await list_scheduled(ENV, 'ada');
		expect(list).toHaveLength(1);
	});

	it("cancels only the owner's scheduled message", async () => {
		scrollMock.mockResolvedValue([
			{ id: '1', payload: { s: 'sm', f: 'ada', to: 'bob', text: 'hi', at: 1, sent: 0 } }
		]);
		expect(await cancel_scheduled(ENV, 'ada', '1')).toBe(true);
		expect(removeMock).toHaveBeenCalledWith(ENV, ['1']);
	});

	it("refuses to cancel someone else's scheduled message", async () => {
		scrollMock.mockImplementation(async (_e, filter) => {
			const uidCond = filter.must.find((c: { key: string }) => c.key === 'f');
			return uidCond?.match.value === 'ada'
				? [{ id: '1', payload: { s: 'sm', f: 'ada', to: 'bob', text: 'hi', at: 1, sent: 0 } }]
				: [];
		});
		expect(await cancel_scheduled(ENV, 'mallory', '1')).toBe(false);
		expect(removeMock).not.toHaveBeenCalled();
	});
});

describe('due_scheduled', () => {
	it('queries for unsent messages due at or before now', async () => {
		await due_scheduled(ENV, 5000);
		const filter = scrollMock.mock.calls[0][1];
		expect(filter.must).toEqual(
			expect.arrayContaining([
				{ key: 's', match: { value: 'sm' } },
				{ key: 'sent', match: { value: 0 } }
			])
		);
	});
});

describe('send_scheduled_batch', () => {
	let relay_body: unknown;
	const ws = {
		fetch: vi.fn(async (_url: string, init: { body: string }) => {
			relay_body = JSON.parse(init.body);
			return new Response(JSON.stringify({ delivered: true }));
		})
	} as unknown as Fetcher;

	it('sends everything due and marks it sent, with no vector on the sent row', async () => {
		scrollMock.mockResolvedValue([
			{ id: '1', payload: { s: 'sm', f: 'ada', to: 'bob', text: 'hi', at: 1, sent: 0 } }
		]);
		await send_scheduled_batch(ENV, ws, 1000);
		const sentUpsert = upsertMock.mock.calls.find((c) => c[1][0].payload.s === 'sm');
		expect(sentUpsert![1][0].payload.sent).toBe(1);
		expect(sentUpsert![1][0].vector).toEqual({});
	});

	it('skips messages scheduled in the future', async () => {
		scrollMock.mockResolvedValue([]);
		await send_scheduled_batch(ENV, ws, 1000);
		expect(upsertMock).not.toHaveBeenCalledWith(
			expect.anything(),
			expect.arrayContaining([
				expect.objectContaining({ payload: expect.objectContaining({ s: 'm' }) })
			])
		);
	});

	it('does not resend an already-sent message', async () => {
		// due_scheduled itself filters sent=0, so an empty result means nothing further happens
		scrollMock.mockResolvedValue([]);
		await send_scheduled_batch(ENV, ws, 1000);
		expect(upsertMock).not.toHaveBeenCalled();
	});

	it('marks sent even if the socket relay throws', async () => {
		scrollMock.mockResolvedValue([
			{ id: '1', payload: { s: 'sm', f: 'ada', to: 'bob', text: 'hi', at: 1, sent: 0 } }
		]);
		const throwingWs = {
			fetch: vi.fn().mockRejectedValue(new Error('down'))
		} as unknown as Fetcher;
		await send_scheduled_batch(ENV, throwingWs, 1000);
		const sentUpsert = upsertMock.mock.calls.find((c) => c[1][0].payload.s === 'sm');
		expect(sentUpsert![1][0].payload.sent).toBe(1);
	});

	it('sends group messages via get_group/is_member', async () => {
		scrollMock.mockResolvedValue([
			{ id: '1', payload: { s: 'sm', f: 'ada', group: 'g1', text: 'hi', at: 1, sent: 0 } }
		]);
		await send_scheduled_batch(ENV, ws, 1000);
		expect(getGroupMock).toHaveBeenCalledWith(ENV, 'g1');
		const msgUpsert = upsertMock.mock.calls.find((c) => c[1][0].payload.s === 'm');
		expect(msgUpsert![1][0].payload).toMatchObject({ gr: 'g1', f: 'ada', x: 'enc:hi' });
	});

	it('carries conv and mute_key (the sender) in a 1:1 relay, for the recipient’s own DO', async () => {
		scrollMock.mockResolvedValue([
			{ id: '1', payload: { s: 'sm', f: 'ada', to: 'bob', text: 'hi', at: 1, sent: 0 } }
		]);
		await send_scheduled_batch(ENV, ws, 1000);
		expect(relay_body).toMatchObject({
			to: 'bob',
			conv: 'ada|bob',
			mute_key: 'ada',
			kind: 'u',
			reply_to: 'ada'
		});
	});

	it('carries conv and mute_key (the group id) in a room relay', async () => {
		scrollMock.mockResolvedValue([
			{ id: '1', payload: { s: 'sm', f: 'ada', group: 'g1', text: 'hi', at: 1, sent: 0 } }
		]);
		await send_scheduled_batch(ENV, ws, 1000);
		expect(relay_body).toMatchObject({
			group: 'g1',
			conv: 'g:g1',
			mute_key: 'g1',
			kind: 'r',
			reply_to: 'g1'
		});
	});
});
