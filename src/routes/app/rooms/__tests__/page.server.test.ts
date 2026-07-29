import { describe, it, expect, vi, beforeEach } from 'vitest';

const { listGroupsMock, listFoldersMock } = vi.hoisted(() => ({
	listGroupsMock: vi.fn(),
	listFoldersMock: vi.fn()
}));

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$lib/server/group', () => ({ list_groups: listGroupsMock }));
vi.mock('$lib/server/folders', () => ({ list_folders: listFoldersMock }));

import { load } from '../+page.server';

beforeEach(() => {
	vi.clearAllMocks();
	listGroupsMock.mockResolvedValue([{ id: 'g1', name: 'room1', members: ['ada'], score: 0 }]);
	listFoldersMock.mockResolvedValue([{ id: 'f1', name: 'gaming', convs: ['g1'], k: 'r' }]);
});

describe('/app/rooms page server', () => {
	it('401s when signed out', async () => {
		await expect(load({ locals: { user: null } } as any)).rejects.toMatchObject({ status: 401 });
	});

	it('returns the rooms the user belongs to', async () => {
		const data = await load({ locals: { user: { id: 'ada', username: 'ada' } } } as any);
		expect(data.mine).toHaveLength(1);
		expect(data.mine[0].id).toBe('g1');
	});

	it('returns only room-kind folders', async () => {
		await load({ locals: { user: { id: 'ada', username: 'ada' } } } as any);
		expect(listFoldersMock).toHaveBeenCalledWith({}, 'ada', 'r');
	});
});
