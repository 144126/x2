import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
	getUserNamesMock,
	listFoldersMock,
	hubConvsMock,
	listMutesMock,
	hubChatHubError
} = vi.hoisted(() => ({
	getUserNamesMock: vi.fn(),
	listFoldersMock: vi.fn(),
	hubConvsMock: vi.fn(),
	listMutesMock: vi.fn(),
	hubChatHubError: class extends Error {
		constructor(public reason: string) {
			super(reason);
		}
	}
}));

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$lib/server/chat', () => ({ get_user_names: getUserNamesMock }));
vi.mock('$lib/server/folders', () => ({ list_folders: listFoldersMock }));
vi.mock('$lib/server/hub_client', () => ({
	hub_convs: hubConvsMock,
	ChatHubError: hubChatHubError
}));
vi.mock('$lib/server/mute', () => ({ list_mutes: listMutesMock }));

import { load } from '../+page.server';

function event(uid: string | null = 'me') {
	return {
		locals: { user: uid ? { id: uid, username: 'me' } : null, x2_ws: {} }
	} as unknown as Parameters<typeof load>[0];
}

beforeEach(() => {
	vi.clearAllMocks();
	hubConvsMock.mockResolvedValue([]);
	getUserNamesMock.mockResolvedValue({});
	listFoldersMock.mockResolvedValue([]);
	listMutesMock.mockResolvedValue([]);
});

describe('GET /app/chats', () => {
	it('401s when signed out', async () => {
		await expect(load(event(null))).rejects.toMatchObject({ status: 401 });
	});

	it('loads conv index via a single hub call — zero Qdrant scrolls', async () => {
		await load(event('me'));
		expect(hubConvsMock).toHaveBeenCalledTimes(1);
	});

	it('returns conversations with resolved usernames', async () => {
		hubConvsMock.mockResolvedValue([{ peer: 'bob', last: 100, preview: 'hey' }, { peer: 'carol', last: 50, preview: 'hi' }]);
		getUserNamesMock.mockResolvedValue({ bob: 'Bobby', carol: 'Carol' });
		const data = (await load(event('me'))) as { convs: { peer: string; name: string }[] };
		expect(getUserNamesMock).toHaveBeenCalledWith(expect.anything(), ['bob', 'carol']);
		expect(data.convs[0].name).toBe('Bobby');
		expect(data.convs[1].name).toBe('Carol');
	});

	it('unread counts are embedded in each conv entry from the hub', async () => {
		hubConvsMock.mockResolvedValue([{ peer: 'bob', last: 100, preview: 'hey', unread: 3 }]);
		const data = (await load(event('me'))) as { convs: { peer: string; unread: number }[] };
		expect(data.convs[0].unread).toBe(3);
	});

	it('flags a conversation whose peer is muted', async () => {
		hubConvsMock.mockResolvedValue([{ peer: 'bob', last: 100, preview: 'hey' }]);
		listMutesMock.mockResolvedValue([{ s: 'mu', ow: 'me', tg: 'bob', k: 'u', until: 0, d: 1 }]);
		const data = (await load(event('me'))) as { convs: { peer: string; muted: boolean }[] };
		expect(data.convs[0].muted).toBe(true);
	});

	it('does not flag a conversation whose mute is a room mute with a coincidental id', async () => {
		hubConvsMock.mockResolvedValue([{ peer: 'r1', last: 100, preview: 'hey' }]);
		listMutesMock.mockResolvedValue([{ s: 'mu', ow: 'me', tg: 'r1', k: 'r', until: 0, d: 1 }]);
		const data = (await load(event('me'))) as { convs: { peer: string; muted: boolean }[] };
		expect(data.convs[0].muted).toBe(false);
	});

	it('asks for chat folders only', async () => {
		await load(event('me'));
		expect(listFoldersMock).toHaveBeenCalledWith(expect.anything(), 'me', 'c');
	});

	it('reports hub_error instead of the empty state when the hub read fails', async () => {
		hubConvsMock.mockRejectedValue(new hubChatHubError('network'));
		const data = (await load(event('me'))) as { convs: unknown[]; hub_error: string | null };
		expect(data.convs).toEqual([]);
		expect(data.hub_error).toBe('network');
	});
});
