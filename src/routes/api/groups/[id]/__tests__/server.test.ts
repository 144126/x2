import { describe, it, expect, vi, beforeEach } from 'vitest';

const { updateGroupMock, getGroupMock, deleteGroupMock, joinGroupMock, leaveGroupMock, ensureDeviceSessionMock } =
	vi.hoisted(() => ({
		updateGroupMock: vi.fn(),
		getGroupMock: vi.fn(),
		deleteGroupMock: vi.fn(),
		joinGroupMock: vi.fn(),
		leaveGroupMock: vi.fn(),
		ensureDeviceSessionMock: vi.fn()
	}));

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$lib/server/group', () => ({
	update_group: updateGroupMock,
	get_group: getGroupMock,
	delete_group: deleteGroupMock,
	join_group: joinGroupMock,
	leave_group: leaveGroupMock
}));
vi.mock('$lib/server/device', () => ({ ensure_device_session: ensureDeviceSessionMock }));

import { PATCH, POST } from '../+server';

function patchEvent(body: unknown, uid = 'me') {
	return {
		params: { id: 'g1' },
		request: new Request('https://x/api/groups/g1', {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: body !== undefined ? JSON.stringify(body) : undefined
		}),
		locals: { user: uid ? { id: uid, username: 'Me' } : null, x2_ws: {} }
	} as unknown as Parameters<typeof PATCH>[0];
}

function postEvent(body: unknown, uid: string | null = 'me') {
	return {
		params: { id: 'g1' },
		request: new Request('https://x/api/groups/g1', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		}),
		locals: { user: uid ? { id: uid, username: 'Me' } : null, x2_ws: {} }
	} as unknown as Parameters<typeof POST>[0];
}

beforeEach(() => {
	vi.clearAllMocks();
	updateGroupMock.mockResolvedValue({ id: 'g1', name: 'test' });
	joinGroupMock.mockResolvedValue({ id: 'g1', name: 'test', members: ['dev1'] });
	ensureDeviceSessionMock.mockResolvedValue(null);
});

describe('PATCH /api/groups/[id]', () => {
	it('persists country, state and city on update', async () => {
		await PATCH(patchEvent({ country: 'US', state: 'CA', city: 'SF' }));
		expect(updateGroupMock).toHaveBeenCalledWith(
			expect.anything(),
			'g1',
			'me',
			expect.objectContaining({ country: 'US', state: 'CA', city: 'SF' })
		);
	});
});

describe('POST /api/groups/[id] — anonymous device join', () => {
	it('joins as a freshly-minted device user when a device_id is present', async () => {
		ensureDeviceSessionMock.mockResolvedValue({ id: 'dev1', username: 'dev1' });
		const res = await POST(postEvent({ action: 'join' }, null));
		expect(res.status).toBe(200);
		expect(joinGroupMock).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'g1', 'dev1');
	});

	it('still 401s an anonymous POST with no device_id at all', async () => {
		await expect(POST(postEvent({ action: 'join' }, null))).rejects.toMatchObject({ status: 401 });
		expect(joinGroupMock).not.toHaveBeenCalled();
	});
});
