import { describe, it, expect, vi, beforeEach } from 'vitest';

const { hubUnreadMock, hubMarkReadMock } = vi.hoisted(() => ({
	hubUnreadMock: vi.fn(),
	hubMarkReadMock: vi.fn()
}));

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$lib/server/hub_client', () => ({
	hub_unread: hubUnreadMock,
	hub_mark_read: hubMarkReadMock
}));

import { GET, POST } from '../+server';

function event(body?: unknown, uid: string | null = 'me') {
	return {
		request: new Request('https://x/api/read', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			...(body === undefined ? {} : { body: JSON.stringify(body) })
		}),
		locals: { user: uid ? { id: uid, username: 'me' } : null, x2_ws: {} }
	} as unknown as Parameters<typeof POST>[0];
}

beforeEach(() => {
	vi.clearAllMocks();
	hubUnreadMock.mockResolvedValue({ total: 0, by_conv: {} });
	hubMarkReadMock.mockResolvedValue(0);
});

describe('GET /api/read — what is still unread', () => {
	it('401s when signed out', async () => {
		await expect(GET(event(undefined, null))).rejects.toMatchObject({ status: 401 });
	});

	it('proxies the hub’s total and by_conv, scoped to the signed-in user', async () => {
		hubUnreadMock.mockResolvedValue({ total: 3, by_conv: { 'a|me': 2, 'g:1': 1 } });
		expect(await (await GET(event())).json()).toEqual({
			total: 3,
			by_conv: { 'a|me': 2, 'g:1': 1 }
		});
		expect(hubUnreadMock).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'me');
	});

	it('reports zero for a user with nothing waiting', async () => {
		expect(await (await GET(event())).json()).toEqual({ total: 0, by_conv: {} });
	});
});

describe('POST /api/read — mark a conversation read', () => {
	it('401s when signed out', async () => {
		await expect(POST(event({ conv: 'a|me' }, null))).rejects.toMatchObject({ status: 401 });
		expect(hubMarkReadMock).not.toHaveBeenCalled();
	});

	it('marks the conversation read for the caller only', async () => {
		await POST(event({ conv: 'a|me', ts: 500 }));
		expect(hubMarkReadMock).toHaveBeenCalledWith(
			expect.anything(),
			expect.anything(),
			'me',
			'a|me',
			500
		);
	});

	it('defaults the read point to now when none is given', async () => {
		await POST(event({ conv: 'a|me' }));
		expect(hubMarkReadMock.mock.calls[0][4]).toBeUndefined();
	});

	it('400s without a conversation', async () => {
		await expect(POST(event({}))).rejects.toMatchObject({ status: 400 });
	});

	it('400s on a missing body', async () => {
		await expect(POST(event())).rejects.toMatchObject({ status: 400 });
	});

	it('returns the fresh total so the client can update the badge in one round trip', async () => {
		hubMarkReadMock.mockResolvedValue(4);
		expect(await (await POST(event({ conv: 'a|me' }))).json()).toMatchObject({ total: 4 });
	});
});
