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

import { save_folder, list_folders, assign_conv, unassign_conv, delete_folder } from '../folders';

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
		expect(fo).toMatchObject({ s: 'fo', owner: 'ada', name: 'close friends', convs: [] });
	});
});

describe('list_folders', () => {
	it("returns only the owner's folders", async () => {
		scrollMock.mockResolvedValue([{ id: '1', payload: { s: 'fo', owner: 'ada', name: 'x', convs: [], d: 1 } }]);
		const list = await list_folders(ENV, 'ada');
		expect(list).toHaveLength(1);
	});
});

describe('assign_conv / unassign_conv', () => {
	it('adds a conv id to the folder, without duplicating on repeat assign', async () => {
		scrollMock.mockResolvedValue([{ id: 'f1', payload: { s: 'fo', id: 'f1', owner: 'ada', name: 'x', convs: ['bob'], d: 1 } }]);
		await assign_conv(ENV, 'ada', 'f1', 'bob');
		expect(upsertMock.mock.calls[0][1][0].payload.convs).toEqual(['bob']);
	});

	it('appends a new conv id', async () => {
		scrollMock.mockResolvedValue([{ id: 'f1', payload: { s: 'fo', id: 'f1', owner: 'ada', name: 'x', convs: ['bob'], d: 1 } }]);
		await assign_conv(ENV, 'ada', 'f1', 'g:g1');
		expect(upsertMock.mock.calls[0][1][0].payload.convs).toEqual(['bob', 'g:g1']);
	});

	it('removes a conv id on unassign', async () => {
		scrollMock.mockResolvedValue([{ id: 'f1', payload: { s: 'fo', id: 'f1', owner: 'ada', name: 'x', convs: ['bob', 'cid'], d: 1 } }]);
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
		scrollMock.mockResolvedValue([{ id: 'f1', payload: { s: 'fo', id: 'f1', owner: 'ada', name: 'x', convs: [], d: 1 } }]);
		expect(await delete_folder(ENV, 'ada', 'f1')).toBe(true);
		expect(removeMock).toHaveBeenCalledWith(ENV, ['f1']);
	});

	it('refuses to delete someone else\'s folder', async () => {
		scrollMock.mockResolvedValue([]);
		expect(await delete_folder(ENV, 'mallory', 'f1')).toBe(false);
		expect(removeMock).not.toHaveBeenCalled();
	});
});
