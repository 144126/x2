import { describe, it, expect, vi, beforeEach } from 'vitest';

const { muteMock, unmuteMock, listMutesMock } = vi.hoisted(() => ({
	muteMock: vi.fn(),
	unmuteMock: vi.fn(),
	listMutesMock: vi.fn()
}));

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$lib/server/mute', () => ({
	mute: muteMock,
	unmute: unmuteMock,
	list_mutes: listMutesMock
}));

import { GET, POST, DELETE } from '../+server';

function event(
	method: 'GET' | 'POST' | 'DELETE',
	body?: unknown,
	uid: string | null = 'ada',
	query?: string
) {
	const raw = query ? `https://x/api/mute?${query}` : 'https://x/api/mute';
	const url = new URL(raw);
	return {
		request: new Request(url, {
			method,
			headers: { 'content-type': 'application/json' },
			...(body === undefined ? {} : { body: JSON.stringify(body) })
		}),
		url,
		locals: { user: uid ? { id: uid, username: 'ada' } : null }
	} as unknown as Parameters<typeof POST>[0];
}

beforeEach(() => {
	vi.clearAllMocks();
	muteMock.mockResolvedValue({ s: 'mu', ow: 'ada', tg: 'bob', k: 'u', until: 0, d: 1 });
	listMutesMock.mockResolvedValue([]);
});

describe('GET /api/mute', () => {
	it('401s when signed out', async () => {
		await expect(GET(event('GET', undefined, null))).rejects.toMatchObject({ status: 401 });
	});

	it("returns the caller's live mutes on GET", async () => {
		listMutesMock.mockResolvedValue([{ s: 'mu', ow: 'ada', tg: 'bob', k: 'u', until: 0, d: 1 }]);
		const res = await GET(event('GET'));
		const body = await res.json();
		expect(body.mutes).toHaveLength(1);
		expect(body.mutes[0]).toMatchObject({ tg: 'bob' });
	});
});

describe('POST /api/mute', () => {
	it('401s when signed out', async () => {
		await expect(POST(event('POST', { target: 'bob', kind: 'u' }, null))).rejects.toMatchObject({
			status: 401
		});
	});

	it('400s without a target', async () => {
		await expect(POST(event('POST', { kind: 'u' }))).rejects.toMatchObject({ status: 400 });
	});

	it('400s on a missing body', async () => {
		await expect(POST(event('POST', undefined))).rejects.toMatchObject({ status: 400 });
	});

	it('400s when kind is neither u nor r', async () => {
		await expect(POST(event('POST', { target: 'bob', kind: 'x' }))).rejects.toMatchObject({
			status: 400
		});
	});

	it('400s when a user tries to mute themselves', async () => {
		await expect(POST(event('POST', { target: 'ada', kind: 'u' }))).rejects.toMatchObject({
			status: 400
		});
	});

	it('mutes indefinitely when no expiry is given', async () => {
		await POST(event('POST', { target: 'bob', kind: 'u' }));
		expect(muteMock).toHaveBeenCalledWith(expect.anything(), 'ada', 'bob', 'u', 0);
	});

	it('converts a future expiry into an absolute until', async () => {
		const future = Date.now() + 10_000;
		await POST(event('POST', { target: 'bob', kind: 'u', until: future }));
		expect(muteMock).toHaveBeenCalledWith(expect.anything(), 'ada', 'bob', 'u', future);
	});

	it('ignores an expiry already in the past, muting indefinitely instead', async () => {
		await POST(event('POST', { target: 'bob', kind: 'u', until: 1 }));
		expect(muteMock).toHaveBeenCalledWith(expect.anything(), 'ada', 'bob', 'u', 0);
	});

	it('never lets one user mute on behalf of another', async () => {
		await POST(event('POST', { target: 'bob', kind: 'u', ow: 'mallory' }));
		expect(muteMock).toHaveBeenCalledWith(expect.anything(), 'ada', 'bob', 'u', 0);
	});
});

describe('DELETE /api/mute', () => {
	it('401s when signed out', async () => {
		await expect(DELETE(event('DELETE', undefined, null, 'target=bob'))).rejects.toMatchObject({
			status: 401
		});
	});

	it('unmutes the target named in the query string', async () => {
		await DELETE(event('DELETE', undefined, 'ada', 'target=bob'));
		expect(unmuteMock).toHaveBeenCalledWith(expect.anything(), 'ada', 'bob');
	});

	it('400s on DELETE without a target', async () => {
		await expect(DELETE(event('DELETE', undefined, 'ada'))).rejects.toMatchObject({ status: 400 });
	});
});
