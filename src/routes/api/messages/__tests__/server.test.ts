import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getMessagesMock, getGroupMessagesMock } = vi.hoisted(() => ({
	getMessagesMock: vi.fn(),
	getGroupMessagesMock: vi.fn()
}));

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$lib/server/chat', () => ({
	get_messages: getMessagesMock,
	get_group_messages: getGroupMessagesMock
}));

import { GET } from '../+server';

function event(url: string, uid: string | null = 'me') {
	return {
		url: new URL(url),
		locals: { user: uid ? { id: uid, username: 'me' } : null }
	} as unknown as Parameters<typeof GET>[0];
}

beforeEach(() => {
	vi.clearAllMocks();
	getMessagesMock.mockResolvedValue([]);
	getGroupMessagesMock.mockResolvedValue([]);
});

describe('GET /api/messages', () => {
	it('401s when signed out', async () => {
		await expect(GET(event('https://x/api/messages?u=peer', null))).rejects.toMatchObject({
			status: 401
		});
	});

	it('400s when neither u nor g is given', async () => {
		await expect(GET(event('https://x/api/messages'))).rejects.toMatchObject({ status: 400 });
	});

	it('fetches a 1:1 thread by peer, forwarding the cursor', async () => {
		await GET(event('https://x/api/messages?u=peer&before=100'));
		expect(getMessagesMock).toHaveBeenCalledWith({}, 'me', 'peer', 100);
		expect(getGroupMessagesMock).not.toHaveBeenCalled();
	});

	it('fetches a group thread by g, forwarding the cursor', async () => {
		await GET(event('https://x/api/messages?g=room1&before=100'));
		expect(getGroupMessagesMock).toHaveBeenCalledWith({}, 'room1', 'me', 100);
		expect(getMessagesMock).not.toHaveBeenCalled();
	});

	it('omits the cursor when before is absent', async () => {
		await GET(event('https://x/api/messages?u=peer'));
		expect(getMessagesMock).toHaveBeenCalledWith({}, 'me', 'peer', undefined);
	});

	it('prefers g over u when both are given', async () => {
		await GET(event('https://x/api/messages?u=peer&g=room1'));
		expect(getGroupMessagesMock).toHaveBeenCalled();
		expect(getMessagesMock).not.toHaveBeenCalled();
	});
});
