import { describe, it, expect, vi, beforeEach } from 'vitest';

const { ensureMock, upsertMock, scrollMock, removeMock } = vi.hoisted(() => ({
	ensureMock: vi.fn(),
	upsertMock: vi.fn(),
	scrollMock: vi.fn(),
	removeMock: vi.fn()
}));

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

import {
	save_folder,
	list_folders,
	assign_conv,
	unassign_conv,
	delete_folder,
	type Folder
} from '../folders';

const ENV = { QDRANT_URL: 'u', QDRANT_KEY: 'k' };

beforeEach(() => {
	vi.clearAllMocks();
	ensureMock.mockResolvedValue(undefined);
	upsertMock.mockResolvedValue(undefined);
	scrollMock.mockResolvedValue([]);
	removeMock.mockResolvedValue(undefined);
});

describe('save_folder', () => {
	it('creates a folder owned by the caller with an empty conv list', async () => {
		const fo = await save_folder(ENV, 'ada', 'close friends');
		expect(fo).toMatchObject({ s: 'fo', ow: 'ada', name: 'close friends', convs: [] });
	});

	it('writes no vector — a folder is never searched', async () => {
		await save_folder(ENV, 'ada', 'close friends');
		expect(upsertMock.mock.calls[0][1][0].vector).toEqual({});
	});
});

describe('payload/filter coherence', () => {
	it('writes every payload key that list_folders later filters on', async () => {
		await save_folder(ENV, 'ada', 'close friends');
		const payload = upsertMock.mock.calls[0][1][0].payload;

		scrollMock.mockResolvedValue([]);
		await list_folders(ENV, 'ada');
		const filter = scrollMock.mock.calls[0][1] as {
			must: { key: string; match: { value: string } }[];
		};

		// a filter key absent from the written payload matches nothing in Qdrant — silent data loss
		for (const cond of filter.must) {
			expect(payload).toHaveProperty(cond.key, cond.match.value);
		}
	});
});

describe('list_folders', () => {
	it("returns only the owner's folders", async () => {
		scrollMock.mockResolvedValue([
			{ id: '1', payload: { s: 'fo', ow: 'ada', name: 'x', convs: [], d: 1 } }
		]);
		const list = await list_folders(ENV, 'ada');
		expect(list).toHaveLength(1);
	});
});

describe('assign_conv / unassign_conv', () => {
	it('adds a conv id to the folder, without duplicating on repeat assign', async () => {
		scrollMock.mockResolvedValue([
			{ id: 'f1', payload: { s: 'fo', id: 'f1', ow: 'ada', name: 'x', convs: ['bob'], d: 1 } }
		]);
		await assign_conv(ENV, 'ada', 'f1', 'bob');
		expect(upsertMock.mock.calls[0][1][0].payload.convs).toEqual(['bob']);
	});

	it('appends a new conv id', async () => {
		scrollMock.mockResolvedValue([
			{ id: 'f1', payload: { s: 'fo', id: 'f1', ow: 'ada', name: 'x', convs: ['bob'], d: 1 } }
		]);
		await assign_conv(ENV, 'ada', 'f1', 'g:g1');
		expect(upsertMock.mock.calls[0][1][0].payload.convs).toEqual(['bob', 'g:g1']);
	});

	it('removes a conv id on unassign', async () => {
		scrollMock.mockResolvedValue([
			{
				id: 'f1',
				payload: { s: 'fo', id: 'f1', ow: 'ada', name: 'x', convs: ['bob', 'cid'], d: 1 }
			}
		]);
		await unassign_conv(ENV, 'ada', 'f1', 'bob');
		expect(upsertMock.mock.calls[0][1][0].payload.convs).toEqual(['cid']);
	});

	it('refuses to touch a folder owned by someone else', async () => {
		scrollMock.mockResolvedValue([]);
		await assign_conv(ENV, 'mallory', 'f1', 'bob');
		expect(upsertMock).not.toHaveBeenCalled();
	});
});

describe('delete_folder', () => {
	it("deletes only the owner's folder", async () => {
		scrollMock.mockResolvedValue([
			{ id: 'f1', payload: { s: 'fo', id: 'f1', ow: 'ada', name: 'x', convs: [], d: 1 } }
		]);
		expect(await delete_folder(ENV, 'ada', 'f1')).toBe(true);
		expect(removeMock).toHaveBeenCalledWith(ENV, ['f1']);
	});

	it("refuses to delete someone else's folder", async () => {
		scrollMock.mockResolvedValue([]);
		expect(await delete_folder(ENV, 'mallory', 'f1')).toBe(false);
		expect(removeMock).not.toHaveBeenCalled();
	});
});

describe('folder kinds', () => {
	beforeEach(() => {
		upsertMock.mockClear();
		scrollMock.mockClear();
		ensureMock.mockClear();
	});

	it('defaults a new folder to the chat kind', async () => {
		const fo = await save_folder(ENV, 'ada', 'f');
		expect(fo).toMatchObject({ k: 'c' });
	});

	it('creates a room folder when asked', async () => {
		const fo = await save_folder(ENV, 'ada', 'f', 'r');
		expect(fo).toMatchObject({ k: 'r' });
	});

	it('lists only chat folders when kind is c', async () => {
		scrollMock.mockResolvedValue([
			{ id: '1', payload: { s: 'fo', id: '1', ow: 'ada', name: 'c1', convs: [], d: 1, k: 'c' } },
			{ id: '2', payload: { s: 'fo', id: '2', ow: 'ada', name: 'r1', convs: [], d: 2, k: 'r' } }
		]);
		const list = await list_folders(ENV, 'ada', 'c');
		expect(list).toHaveLength(1);
		expect(list[0].name).toBe('c1');
	});

	it('lists only room folders when kind is r', async () => {
		scrollMock.mockResolvedValue([
			{ id: '1', payload: { s: 'fo', id: '1', ow: 'ada', name: 'c1', convs: [], d: 1, k: 'c' } },
			{ id: '2', payload: { s: 'fo', id: '2', ow: 'ada', name: 'r1', convs: [], d: 2, k: 'r' } }
		]);
		const list = await list_folders(ENV, 'ada', 'r');
		expect(list).toHaveLength(1);
		expect(list[0].name).toBe('r1');
	});

	it('lists every folder when no kind is given', async () => {
		scrollMock.mockResolvedValue([
			{ id: '1', payload: { s: 'fo', id: '1', ow: 'ada', name: 'c1', convs: [], d: 1, k: 'c' } },
			{ id: '2', payload: { s: 'fo', id: '2', ow: 'ada', name: 'r1', convs: [], d: 2, k: 'r' } }
		]);
		const list = await list_folders(ENV, 'ada');
		expect(list).toHaveLength(2);
	});

	it('treats a legacy folder with no k field as a chat folder', async () => {
		scrollMock.mockResolvedValue([
			{ id: '1', payload: { s: 'fo', id: '1', ow: 'ada', name: 'old', convs: [], d: 1 } }
		]);
		const list = await list_folders(ENV, 'ada', 'c');
		expect(list).toHaveLength(1);
		expect(list[0].name).toBe('old');
		// filter is done in JS — no k condition in the Qdrant scroll filter
		const filter = scrollMock.mock.calls[0][1] as { must: { key: string }[] };
		const keys = filter.must.map((c: { key: string }) => c.key);
		expect(keys).not.toContain('k');
	});

	it('assigns a room id to a room folder', async () => {
		scrollMock.mockResolvedValue([
			{
				id: 'f1',
				payload: { s: 'fo', id: 'f1', ow: 'ada', name: 'x', convs: ['g1'], d: 1, k: 'r' }
			}
		]);
		await assign_conv(ENV, 'ada', 'f1', 'g1');
		// no assertion needed beyond no error — 'g1' (bare room id) is already in convs
		expect(upsertMock).toHaveBeenCalled();
	});
});
