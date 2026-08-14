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
	getGroupMock.mockResolvedValue({
		id: 'g1',
		name: 'r',
		members: ['ada', 'lurker'],
		owner: 'ada',
		created: 1
	});
	getGroupMessagesMock.mockResolvedValue([]);
	getUserNamesMock.mockResolvedValue({ ada: 'Ada', lurker: 'Lurker' });
	isMocked.mockResolvedValue(false);
});

describe('/~[handle] page server', () => {
	it('makes one batched name lookup, not one per member', async () => {
		getGroupMessagesMock.mockResolvedValue([
			{ f: 'ada', x: 'hi', d: 1 },
			{ f: 'bob', x: 'hey', d: 2 }
		]);
		await load({ params: { handle: 'g1' }, locals: { user: { id: 'ada' } } } as any);
		expect(getUserNamesMock).toHaveBeenCalledTimes(1);
	});

	it('resolves names for members who have never posted', async () => {
		getUserNamesMock.mockResolvedValue({ ada: 'Ada', lurker: 'Lurker' });
		const data = await load({ params: { handle: 'g1' }, locals: { user: { id: 'ada' } } } as any);
		expect(data.names.lurker).toBe('Lurker');
	});

	it('serves an anonymous visitor the room, its names and the message history', async () => {
		getGroupMessagesMock.mockResolvedValue([{ f: 'ada', x: 'no longer secret', d: 1 }]);
		const data = (await load({ params: { handle: 'g1' }, locals: { user: null } } as any)) as {
			g: { id: string };
			names: Record<string, string>;
			messages: { x: string }[];
			muted: boolean;
		};
		expect(data.g.id).toBe('g1');
		expect(data.names).toEqual({ ada: 'Ada', lurker: 'Lurker' });
		expect(data.messages).toEqual([{ f: 'ada', x: 'no longer secret', d: 1 }]);
		// muting is a thing you do to your own feed, so there is nobody to mute for
		expect(data.muted).toBe(false);
		expect(isMocked).not.toHaveBeenCalled();
	});
});
