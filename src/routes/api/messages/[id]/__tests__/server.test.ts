import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getMessageMock, isMemberMock } = vi.hoisted(() => ({
	getMessageMock: vi.fn(),
	isMemberMock: vi.fn()
}));

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$lib/server/chat', () => ({ get_message: getMessageMock }));
vi.mock('$lib/server/group', () => ({ is_member: isMemberMock }));

import { GET } from '../+server';

function event(id: string, uid: string | null = 'me') {
	return {
		params: { id },
		locals: { user: uid ? { id: uid } : null, x2_ws: {} }
	} as unknown as Parameters<typeof GET>[0];
}

beforeEach(() => vi.clearAllMocks());

describe('GET /api/messages/[id]', () => {
	it('401s when signed out', async () => {
		await expect(GET(event('m1', null))).rejects.toMatchObject({ status: 401 });
	});
	it('404s when the message does not exist', async () => {
		getMessageMock.mockResolvedValue(null);
		await expect(GET(event('m1'))).rejects.toMatchObject({ status: 404 });
	});
	it('403s a 1:1 message the caller is not a party to', async () => {
		getMessageMock.mockResolvedValue({ id: 'm1', f: 'a', t: 'b' });
		await expect(GET(event('m1', 'stranger'))).rejects.toMatchObject({ status: 403 });
	});
	it('200s a 1:1 message for either participant', async () => {
		getMessageMock.mockResolvedValue({ id: 'm1', f: 'me', t: 'b' });
		const res = await GET(event('m1', 'me'));
		expect(await res.json()).toEqual({ m: { id: 'm1', f: 'me', t: 'b' } });
	});
	it('403s a group message for a non-member', async () => {
		getMessageMock.mockResolvedValue({ id: 'm1', gr: 'g1', f: 'a', t: '' });
		isMemberMock.mockResolvedValue(false);
		await expect(GET(event('m1', 'stranger'))).rejects.toMatchObject({ status: 403 });
	});
	it('200s a group message for a member', async () => {
		getMessageMock.mockResolvedValue({ id: 'm1', gr: 'g1', f: 'a', t: '' });
		isMemberMock.mockResolvedValue(true);
		const res = await GET(event('m1', 'member'));
		expect(res.status).toBe(200);
	});
});
