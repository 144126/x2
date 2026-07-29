import { describe, it, expect, vi, beforeEach } from 'vitest';

const { markMock, byConvMock, totalMock, groupsMock, listMutesMock, mutedConvsMock } = vi.hoisted(() => ({
	markMock: vi.fn(),
	byConvMock: vi.fn(),
	totalMock: vi.fn(),
	groupsMock: vi.fn(),
	listMutesMock: vi.fn().mockResolvedValue([]),
	mutedConvsMock: vi.fn().mockReturnValue([])
}));

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$lib/server/unread', () => ({
	mark_read: markMock,
	unread_by_conv: byConvMock,
	total_unread: totalMock
}));
vi.mock('$lib/server/group', () => ({ list_groups: groupsMock }));
vi.mock('$lib/server/mute', () => ({
	list_mutes: listMutesMock,
	muted_convs: mutedConvsMock
}));

import { GET, POST } from '../+server';

function event(body?: unknown, uid: string | null = 'me') {
	return {
		request: new Request('https://x/api/read', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			...(body === undefined ? {} : { body: JSON.stringify(body) })
		}),
		locals: { user: uid ? { id: uid, username: 'me' } : null }
	} as unknown as Parameters<typeof POST>[0];
}

beforeEach(() => {
	vi.clearAllMocks();
	markMock.mockResolvedValue(undefined);
	byConvMock.mockResolvedValue({});
	totalMock.mockResolvedValue(0);
	groupsMock.mockResolvedValue([]);
});

describe('GET /api/read — what is still unread', () => {
	it('401s when signed out', async () => {
		await expect(GET(event(undefined, null))).rejects.toMatchObject({ status: 401 });
	});

	it('returns per-conversation counts and a total for the app badge', async () => {
		byConvMock.mockResolvedValue({ 'a|me': 2, 'g:1': 1 });
		expect(await (await GET(event())).json()).toEqual({
			total: 3,
			by_conv: { 'a|me': 2, 'g:1': 1 },
			muted: []
		});
	});

	it('includes the groups the user belongs to, whose messages have no `to` field', async () => {
		groupsMock.mockResolvedValue([{ id: '1' }, { id: '2' }]);
		await GET(event());
		expect(byConvMock).toHaveBeenCalledWith(expect.anything(), 'me', ['g:1', 'g:2']);
	});

	it('reports zero for a user with nothing waiting', async () => {
		expect(await (await GET(event())).json()).toEqual({ total: 0, by_conv: {}, muted: [] });
	});

	it('returns the muted conversation ids alongside the counts', async () => {
		listMutesMock.mockResolvedValue([{ s: 'mu', ow: 'me', tg: 'bob', k: 'u', until: 0, d: 1 }]);
		mutedConvsMock.mockReturnValue(['me|bob']);
		byConvMock.mockResolvedValue({ 'me|bob': 2, 'a|me': 1 });
		const body = await (await GET(event())).json();
		expect(body.muted).toContain('me|bob');
		expect(body.by_conv['me|bob']).toBe(2);
	});

	it('returns an empty muted list when nothing is muted', async () => {
		listMutesMock.mockResolvedValue([]);
		mutedConvsMock.mockReturnValue([]);
		byConvMock.mockResolvedValue({ 'a|me': 1 });
		const body = await (await GET(event())).json();
		expect(body.muted).toEqual([]);
	});

	it('still returns a total that matches the sum of unmuted counts', async () => {
		listMutesMock.mockResolvedValue([{ s: 'mu', ow: 'me', tg: 'bob', k: 'u', until: 0, d: 1 }]);
		mutedConvsMock.mockReturnValue(['me|bob']);
		byConvMock.mockResolvedValue({ 'me|bob': 2, 'a|me': 1 });
		const body = await (await GET(event())).json();
		expect(body.total).toBe(1);
	});
});

describe('POST /api/read — mark a conversation read', () => {
	it('401s when signed out', async () => {
		await expect(POST(event({ conv: 'a|me' }, null))).rejects.toMatchObject({ status: 401 });
		expect(markMock).not.toHaveBeenCalled();
	});

	it('marks the conversation read for the caller only', async () => {
		await POST(event({ conv: 'a|me', ts: 500 }));
		expect(markMock).toHaveBeenCalledWith(expect.anything(), 'me', 'a|me', 500);
	});

	it('defaults the read point to now when none is given', async () => {
		await POST(event({ conv: 'a|me' }));
		expect(markMock.mock.calls[0][3]).toBeUndefined();
	});

	it('400s without a conversation', async () => {
		await expect(POST(event({}))).rejects.toMatchObject({ status: 400 });
	});

	it('400s on a missing body', async () => {
		await expect(POST(event())).rejects.toMatchObject({ status: 400 });
	});

	it('returns the fresh total so the client can update the badge in one round trip', async () => {
		totalMock.mockResolvedValue(4);
		expect(await (await POST(event({ conv: 'a|me' }))).json()).toMatchObject({ total: 4 });
	});
});
