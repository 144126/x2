import { describe, it, expect, vi, beforeEach } from 'vitest';

const { searchGroupsMock, listGroupsMock, saveGroupMock, ensureDeviceSessionMock } = vi.hoisted(
	() => ({
		searchGroupsMock: vi.fn(),
		listGroupsMock: vi.fn(),
		saveGroupMock: vi.fn(),
		ensureDeviceSessionMock: vi.fn()
	})
);

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$lib/server/group', () => ({
	search_groups: searchGroupsMock,
	list_groups: listGroupsMock,
	save_group: saveGroupMock
}));
vi.mock('$lib/server/device', () => ({ ensure_device_session: ensureDeviceSessionMock }));
vi.mock('$lib/server/rl', () => ({ guard: vi.fn().mockResolvedValue(undefined) }));

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
		locals: { user: uid ? { id: uid, username: 'Me' } : null, x2_ws: {} },
		platform: undefined
	} as unknown as Parameters<typeof POST>[0];
}

beforeEach(() => {
	vi.clearAllMocks();
	searchGroupsMock.mockResolvedValue([]);
	listGroupsMock.mockResolvedValue([]);
	saveGroupMock.mockResolvedValue({ id: 'g1', name: 'test' });
	ensureDeviceSessionMock.mockResolvedValue(null);
});

describe('GET /api/groups', () => {
	it('lets a signed-out visitor browse rooms', async () => {
		expect(await (await GET(getEvent('/api/groups', ''))).json()).toEqual({ r: [] });
		expect(listGroupsMock).toHaveBeenCalled();
	});

	it('still 401s the mine=1 branch, which has no meaning without an account', async () => {
		await expect(GET(getEvent('/api/groups?mine=1', ''))).rejects.toMatchObject({ status: 401 });
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
		await POST(
			postEvent({ name: 'testroom', country: 'US', state: 'CA', city: 'SF', description: 'desc' })
		);
		expect(saveGroupMock).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'me', {
			name: 'testroom',
			description: 'desc',
			country: 'US',
			state: 'CA',
			city: 'SF'
		});
	});

	it('creates as a freshly-minted device user when an anonymous visitor has a device_id', async () => {
		ensureDeviceSessionMock.mockResolvedValue({ id: 'dev1', username: 'dev1' });
		const res = await POST(postEvent({ name: 'devroom' }, ''));
		expect(res.status).toBe(200);
		expect(saveGroupMock).toHaveBeenCalledWith(
			expect.anything(),
			expect.anything(),
			'dev1',
			expect.objectContaining({ name: 'devroom' })
		);
	});

	it('still 401s an anonymous create with no device_id at all', async () => {
		await expect(POST(postEvent({ name: 'devroom' }, ''))).rejects.toMatchObject({ status: 401 });
		expect(saveGroupMock).not.toHaveBeenCalled();
	});
});
