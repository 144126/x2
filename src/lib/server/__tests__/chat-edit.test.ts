import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
	ensureMock,
	upsertMock,
	retrieveOneMock,
	setPayloadMock,
	clearPayloadMock,
	embedMock,
	getGroupMock
} = vi.hoisted(() => ({
	ensureMock: vi.fn(),
	upsertMock: vi.fn(),
	retrieveOneMock: vi.fn(),
	setPayloadMock: vi.fn(),
	clearPayloadMock: vi.fn(),
	embedMock: vi.fn(),
	getGroupMock: vi.fn()
}));

vi.mock('$lib/server/qdrant', async () => {
	const actual = await vi.importActual<typeof import('$lib/server/qdrant')>('$lib/server/qdrant');
	return {
		...actual,
		ensure: ensureMock,
		upsert: upsertMock,
		retrieve_one: retrieveOneMock,
		set_payload: setPayloadMock,
		clear_payload: clearPayloadMock
	};
});
vi.mock('$lib/server/or', () => ({ embed: embedMock }));
vi.mock('$lib/server/group', () => ({ get_group: getGroupMock, is_member: vi.fn() }));
vi.mock('$lib/server/msg_crypto', () => ({
	encrypt_text: async (_env: unknown, text: string) => `enc:${text}`,
	decrypt_text: async (_env: unknown, stored: string) =>
		stored.startsWith('enc:') ? stored.slice(4) : stored
}));

import { edit_msg, delete_msg } from '../chat';

beforeEach(() => {
	vi.clearAllMocks();
	ensureMock.mockResolvedValue(undefined);
	upsertMock.mockResolvedValue(undefined);
	setPayloadMock.mockResolvedValue(undefined);
	clearPayloadMock.mockResolvedValue(undefined);
	embedMock.mockResolvedValue(new Array(4096).fill(0));
});

describe('edit_msg', () => {
	it('rewrites the text and stamps an edited time', async () => {
		const msg = { s: 'm', id: 'm1', c: 'a|b', f: 'ada', t: 'bob', x: 'old', d: 100 };
		retrieveOneMock.mockResolvedValue({ id: 'm1', payload: msg, vector: null });
		const result = await edit_msg({} as never, 'ada', 'm1', 'new');
		expect(result.x).toBe('new');
		expect(typeof result.e).toBe('number');
		expect(upsertMock).toHaveBeenCalledOnce();
		const upsertCall = upsertMock.mock.calls[0][1][0];
		expect(upsertCall.id).toBe('m1');
		expect(upsertCall.payload.x).toBe('enc:new');
		expect(typeof upsertCall.payload.e).toBe('number');
	});

	it('carries the pre-edit vector forward instead of re-embedding', async () => {
		const msg = { s: 'm', id: 'm1', c: 'a|b', f: 'ada', t: 'bob', x: 'old', d: 100 };
		const pre = new Array(4096).fill(0.1);
		retrieveOneMock.mockResolvedValue({ id: 'm1', payload: msg, vector: pre });
		await edit_msg({} as never, 'ada', 'm1', 'new');
		expect(embedMock).not.toHaveBeenCalled();
		const upsertCall = upsertMock.mock.calls[0][1][0];
		expect(upsertCall.vector).toEqual(pre);
	});

	it('rejects a non-author', async () => {
		const msg = { s: 'm', id: 'm1', c: 'a|b', f: 'ada', t: 'bob', x: 'old', d: 100 };
		retrieveOneMock.mockResolvedValue({ id: 'm1', payload: msg, vector: null });
		await expect(edit_msg({} as never, 'bob', 'm1', 'new')).rejects.toThrow('not author');
	});

	it('rejects a missing message', async () => {
		retrieveOneMock.mockResolvedValue(null);
		await expect(edit_msg({} as never, 'ada', 'missing', 'new')).rejects.toThrow('not found');
	});
});

describe('delete_msg', () => {
	const bucket = () => ({ delete: vi.fn().mockResolvedValue(undefined) }) as never;

	it('author can delete their own message', async () => {
		const msg = { s: 'm', id: 'm1', c: 'a|b', f: 'ada', t: 'bob', x: 'hi', d: 100 };
		retrieveOneMock.mockResolvedValue({ id: 'm1', payload: msg, vector: null });
		const result = await delete_msg({} as never, bucket(), 'ada', 'm1');
		expect(result.c).toBe('a|b');
		expect(result.f).toBe('ada');
		expect(result.t).toBe('bob');
	});

	it('leaves a tombstone rather than a hole, so the thread does not silently lose a row', async () => {
		const msg = { s: 'm', id: 'm1', c: 'a|b', f: 'ada', t: 'bob', x: 'hi', d: 100 };
		retrieveOneMock.mockResolvedValue({ id: 'm1', payload: msg, vector: null });
		await delete_msg({} as never, bucket(), 'ada', 'm1');
		expect(setPayloadMock).toHaveBeenCalledWith(expect.anything(), 'm1', {
			dx: expect.any(Number),
			x: ''
		});
	});

	it('takes the content off the record, not just the text', async () => {
		const msg = { s: 'm', id: 'm1', c: 'a|b', f: 'ada', t: 'bob', x: 'hi', d: 100 };
		retrieveOneMock.mockResolvedValue({ id: 'm1', payload: msg, vector: null });
		await delete_msg({} as never, bucket(), 'ada', 'm1');
		const keys = clearPayloadMock.mock.calls[0][2] as string[];
		for (const k of ['im', 'fl', 'sk', 'rx']) expect(keys).toContain(k);
	});

	it('room owner can delete any message in their room', async () => {
		const msg = { s: 'm', id: 'm1', c: 'g:g1', f: 'bob', t: '', gr: 'g1', x: 'hi', d: 100 };
		retrieveOneMock.mockResolvedValue({ id: 'm1', payload: msg, vector: null });
		getGroupMock.mockResolvedValue({ id: 'g1', owner: 'ada', members: ['ada', 'bob'] });
		const result = await delete_msg({} as never, bucket(), 'ada', 'm1');
		expect(result.gr).toBe('g1');
		expect(setPayloadMock).toHaveBeenCalled();
	});

	it('rejects a non-author non-owner', async () => {
		const msg = { s: 'm', id: 'm1', c: 'a|b', f: 'ada', t: 'bob', x: 'hi', d: 100 };
		retrieveOneMock.mockResolvedValue({ id: 'm1', payload: msg, vector: null });
		await expect(delete_msg({} as never, bucket(), 'bob', 'm1')).rejects.toThrow('not author');
		expect(setPayloadMock).not.toHaveBeenCalled();
	});

	it('deletes the attachment out of R2, so the bytes go with the message', async () => {
		const msg = {
			s: 'm',
			id: 'm1',
			c: 'a|b',
			f: 'ada',
			t: 'bob',
			x: 'hi',
			d: 100,
			im: 'ada/photo.png'
		};
		retrieveOneMock.mockResolvedValue({ id: 'm1', payload: msg, vector: null });
		const b = bucket();
		await delete_msg({} as never, b, 'ada', 'm1');
		expect((b as unknown as { delete: ReturnType<typeof vi.fn> }).delete).toHaveBeenCalledWith(
			'ada/photo.png'
		);
	});
});
