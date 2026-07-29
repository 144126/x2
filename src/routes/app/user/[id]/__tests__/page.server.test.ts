import { describe, it, expect, vi, beforeEach } from 'vitest';

const { retrieveOneMock, sharedGroupsMock } = vi.hoisted(() => ({
	retrieveOneMock: vi.fn(),
	sharedGroupsMock: vi.fn()
}));

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$lib/server/qdrant', async () => {
	const actual = await vi.importActual<typeof import('$lib/server/qdrant')>('$lib/server/qdrant');
	return { ...actual, retrieve_one: retrieveOneMock, ensure: vi.fn() };
});
vi.mock('$lib/server/group', () => ({ shared_groups: sharedGroupsMock }));

import { load } from '../+page.server';

const user = (o: Record<string, unknown> = {}) => ({
	s: 'u',
	u: 'bob',
	d: 1,
	...o
});

function event(uid: string, viewer: string | null = 'me') {
	return {
		params: { id: uid },
		locals: { user: viewer ? { id: viewer, username: 'me' } : null }
	} as unknown as Parameters<typeof load>[0];
}

beforeEach(() => {
	vi.clearAllMocks();
	retrieveOneMock.mockResolvedValue({ id: 'bob', payload: user() });
	sharedGroupsMock.mockResolvedValue([]);
});

describe('GET /app/user/[id] — groups in common', () => {
	it('401s when signed out', async () => {
		await expect(load(event('bob', null))).rejects.toMatchObject({ status: 401 });
	});

	it('loads groups shared between the viewer and the viewed user', async () => {
		sharedGroupsMock.mockResolvedValue([{ id: 'g1', name: 'Ceramics' }]);
		const data = (await load(event('bob', 'me'))) as { shared: unknown };
		expect(sharedGroupsMock).toHaveBeenCalledWith(expect.anything(), 'bob', 'me');
		expect(data.shared).toEqual([{ id: 'g1', name: 'Ceramics' }]);
	});

	it('skips the lookup entirely when viewing your own profile', async () => {
		retrieveOneMock.mockResolvedValue({ id: 'me', payload: user({ u: 'me' }) });
		const data = (await load(event('me', 'me'))) as { shared: unknown };
		expect(sharedGroupsMock).not.toHaveBeenCalled();
		expect(data.shared).toEqual([]);
	});

	it('404s when the user does not exist', async () => {
		retrieveOneMock.mockResolvedValue(null);
		await expect(load(event('ghost', 'me'))).rejects.toMatchObject({ status: 404 });
	});
});
