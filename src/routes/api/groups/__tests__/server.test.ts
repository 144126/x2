import { describe, it, expect, vi, beforeEach } from 'vitest';

const { searchGroupsMock, listGroupsMock, saveGroupMock } = vi.hoisted(() => ({
	searchGroupsMock: vi.fn(),
	listGroupsMock: vi.fn(),
	saveGroupMock: vi.fn()
}));

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$lib/server/group', () => ({
	search_groups: searchGroupsMock,
	list_groups: listGroupsMock,
	save_group: saveGroupMock
}));

import { GET, POST } from '../+server';

function getEvent(url: string, uid = 'me') {
	return {
		url: new URL(`https://x${url}`),
		locals: { user: uid ? { id: uid, username: 'Me' } : null, x2_ws: {} }
	} as unknown as Parameters<typeof GET>[0];
}

function postEvent(body: unknown, uid = 'me') {
	return {
		request: new Request('https://x/api/groups', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: body !== undefined ? JSON.stringify(body) : undefined
		}),
		locals: { user: uid ? { id: uid, username: 'Me' } : null, x2_ws: {} }
	} as unknown as Parameters<typeof POST>[0];
}

beforeEach(() => {
	vi.clearAllMocks();
	searchGroupsMock.mockResolvedValue([]);
	listGroupsMock.mockResolvedValue([]);
	saveGroupMock.mockResolvedValue({ id: 'g1', name: 'test' });
});

describe('GET /api/groups', () => {
	it('401s when signed out', async () => {
		await expect(GET(getEvent('/api/groups', ''))).rejects.toMatchObject({ status: 401 });
	});

	it('passes country, state and city query params through to search_groups', async () => {
		await GET(getEvent('/api/groups?q=test&country=US&state=CA&city=SF'));
		expect(searchGroupsMock).toHaveBeenCalledWith(expect.anything(), 'test', {
			country: 'US',
			state: 'CA',
			city: 'SF'
		});
	});

	it('plain-lists with list_groups when there is no query and no location filters', async () => {
		await GET(getEvent('/api/groups'));
		expect(listGroupsMock).toHaveBeenCalled();
		expect(searchGroupsMock).not.toHaveBeenCalled();
	});
});

describe('POST /api/groups', () => {
	it('401s when signed out', async () => {
		await expect(POST(postEvent({ name: 'test' }, ''))).rejects.toMatchObject({ status: 401 });
	});

	it('persists country, state and city on create', async () => {
		await POST(postEvent({ name: 'testroom', country: 'US', state: 'CA', city: 'SF', description: 'desc' }));
		expect(saveGroupMock).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'me', {
			name: 'testroom',
			description: 'desc',
			country: 'US',
			state: 'CA',
			city: 'SF'
		});
	});
});
