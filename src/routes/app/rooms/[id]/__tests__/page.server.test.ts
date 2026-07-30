import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getGroupMock, getGroupMessagesMock, getUserNamesMock, isMocked } = vi.hoisted(() => ({
	getGroupMock: vi.fn(),
	getGroupMessagesMock: vi.fn(),
	getUserNamesMock: vi.fn(),
	isMocked: vi.fn()
}));

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$lib/server/group', () => ({ get_group: getGroupMock }));
vi.mock('$lib/server/chat', () => ({
	get_group_messages: getGroupMessagesMock,
	get_user_names: getUserNamesMock
}));
vi.mock('$lib/server/mute', () => ({ is_muted: isMocked }));

import { load } from '../+page.server';

beforeEach(() => {
	vi.clearAllMocks();
	getGroupMock.mockResolvedValue({ id: 'g1', name: 'r', members: ['ada', 'lurker'], owner: 'ada', created: 1 });
	getGroupMessagesMock.mockResolvedValue([]);
	getUserNamesMock.mockResolvedValue({ ada: 'Ada', lurker: 'Lurker' });
	isMocked.mockResolvedValue(false);
});

describe('/app/rooms/[id] page server', () => {
	it('makes one batched name lookup, not one per member', async () => {
		getGroupMessagesMock.mockResolvedValue([
			{ f: 'ada', x: 'hi', d: 1 },
			{ f: 'bob', x: 'hey', d: 2 }
		]);
		await load({ params: { id: 'g1' }, locals: { user: { id: 'ada' } } } as any);
		expect(getUserNamesMock).toHaveBeenCalledTimes(1);
	});

	it('resolves names for members who have never posted', async () => {
		getUserNamesMock.mockResolvedValue({ ada: 'Ada', lurker: 'Lurker' });
		const data = await load({ params: { id: 'g1' }, locals: { user: { id: 'ada' } } } as any);
		expect(data.names.lurker).toBe('Lurker');
	});

	it('401s when signed out', async () => {
		await expect(load({ params: { id: 'g1' }, locals: { user: null } } as any)).rejects.toMatchObject({ status: 401 });
	});
});
