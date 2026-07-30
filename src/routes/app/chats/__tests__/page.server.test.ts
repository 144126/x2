import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
	getUserNameMock,
	ensureMock,
	listFoldersMock,
	hubConvsMock,
	listMutesMock
} = vi.hoisted(() => ({
	getUserNameMock: vi.fn(),
	ensureMock: vi.fn(),
	listFoldersMock: vi.fn(),
	hubConvsMock: vi.fn(),
	listMutesMock: vi.fn()
}));

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$lib/server/chat', async () => {
	const actual = await vi.importActual<typeof import('$lib/server/chat')>('$lib/server/chat');
	return { ...actual, get_user_name: getUserNameMock };
});
vi.mock('$lib/server/qdrant', async () => {
	const actual = await vi.importActual<typeof import('$lib/server/qdrant')>('$lib/server/qdrant');
	return { ...actual, ensure: ensureMock };
});
vi.mock('$lib/server/folders', () => ({ list_folders: listFoldersMock }));
vi.mock('$lib/server/hub_client', () => ({ hub_convs: hubConvsMock }));
vi.mock('$lib/server/mute', () => ({ list_mutes: listMutesMock }));

import { load } from '../+page.server';

function event(uid: string | null = 'me') {
	return {
		locals: { user: uid ? { id: uid, username: 'me' } : null, x2_ws: {} }
	} as unknown as Parameters<typeof load>[0];
}

beforeEach(() => {
	vi.clearAllMocks();
	ensureMock.mockResolvedValue(undefined);
	hubConvsMock.mockResolvedValue([]);
	getUserNameMock.mockResolvedValue('Alice');
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
		hubConvsMock.mockResolvedValue([{ peer: 'bob', last: 100, preview: 'hey' }]);
		getUserNameMock.mockResolvedValue('Bob');
		const data = (await load(event('me'))) as { convs: { peer: string; name: string }[] };
		expect(getUserNameMock).toHaveBeenCalledWith(expect.anything(), 'bob');
		expect(data.convs[0].name).toBe('Bob');
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
});
