import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getGroupMock, getGroupMessagesMock, getUserNameMock, isMocked } = vi.hoisted(() => ({
	getGroupMock: vi.fn(),
	getGroupMessagesMock: vi.fn(),
	getUserNameMock: vi.fn(),
	isMocked: vi.fn()
}));

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$lib/server/group', () => ({ get_group: getGroupMock }));
vi.mock('$lib/server/chat', () => ({
	get_group_messages: getGroupMessagesMock,
	get_user_name: getUserNameMock
}));
vi.mock('$lib/server/mute', () => ({ is_muted: isMocked }));

import { load } from '../+page.server';

beforeEach(() => {
	vi.clearAllMocks();
	getGroupMock.mockResolvedValue({ id: 'g1', name: 'r', members: ['ada', 'lurker'], owner: 'ada', created: 1 });
	getGroupMessagesMock.mockResolvedValue([]);
	getUserNameMock.mockResolvedValue('Ada');
	isMocked.mockResolvedValue(false);
});

describe('/app/rooms/[id] page server', () => {
	it('resolves names for members who have never posted', async () => {
		const data = await load({ params: { id: 'g1' }, locals: { user: { id: 'ada' } } } as any);
		expect(data.names.lurker).toBe('Ada');
	});

	it('401s when signed out', async () => {
		await expect(load({ params: { id: 'g1' }, locals: { user: null } } as any)).rejects.toMatchObject({ status: 401 });
	});
});
