import { describe, it, expect, vi, beforeEach } from 'vitest';

const { updateGroupMock } = vi.hoisted(() => ({
	updateGroupMock: vi.fn()
}));

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$lib/server/group', () => ({
	update_group: updateGroupMock,
	get_group: vi.fn(),
	delete_group: vi.fn(),
	join_group: vi.fn(),
	leave_group: vi.fn()
}));

import { PATCH } from '../+server';

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

beforeEach(() => {
	vi.clearAllMocks();
	updateGroupMock.mockResolvedValue({ id: 'g1', name: 'test' });
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
