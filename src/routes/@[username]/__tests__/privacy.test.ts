import { describe, it, expect, vi, beforeEach } from 'vitest';

const { retrieveOneMock, sharedGroupsMock, uidByUsernameMock, isMutedMock } = vi.hoisted(() => ({
	retrieveOneMock: vi.fn(),
	sharedGroupsMock: vi.fn(),
	uidByUsernameMock: vi.fn(),
	isMutedMock: vi.fn()
}));

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$lib/server/qdrant', async () => {
	const actual = await vi.importActual<typeof import('$lib/server/qdrant')>('$lib/server/qdrant');
	return { ...actual, retrieve_one: retrieveOneMock, ensure: vi.fn() };
});
vi.mock('$lib/server/group', () => ({ shared_groups: sharedGroupsMock }));
vi.mock('$lib/server/username', () => ({ uid_by_username: uidByUsernameMock }));
vi.mock('$lib/server/mute', () => ({ is_muted: isMutedMock }));

import { load } from '../+page.server';

const event = (viewer: string | null) =>
	({
		params: { username: 'bob' },
		locals: { user: viewer ? { id: viewer, username: 'me' } : null }
	}) as unknown as Parameters<typeof load>[0];

beforeEach(() => {
	vi.clearAllMocks();
	uidByUsernameMock.mockResolvedValue('bob');
	sharedGroupsMock.mockResolvedValue([]);
	isMutedMock.mockResolvedValue(false);
	retrieveOneMock.mockResolvedValue({
		id: 'bob',
		payload: {
			s: 'u',
			u: 'bob',
			d: 1,
			a: 'hi',
			i: ['chess', 'techno'],
			w: '8012345678',
			co: 'NG'
		}
	});
});

// whatever the loader returns is serialised into the page HTML, so a field the component
// happens not to render is still public. These are the two fields that must never travel.

describe('a profile read without an account', () => {
	it('is readable at all', async () => {
		const data = (await load(event(null))) as { u: { u: string; a?: string } };
		expect(data.u.u).toBe('bob');
		expect(data.u.a).toBe('hi');
	});

	it('carries no phone number, in either field', async () => {
		const data = (await load(event(null))) as { u: { w?: string }; wu?: string };
		expect(data.u.w).toBeUndefined();
		expect(data.wu).toBeUndefined();
	});
});

describe('a profile read with an account', () => {
	it('carries the phone number and its wa.me link', async () => {
		const data = (await load(event('me'))) as { u: { w?: string }; wu?: string };
		expect(data.u.w).toBe('8012345678');
		expect(data.wu).toContain('8012345678');
		expect(data.wu?.startsWith('https://wa.me/')).toBe(true);
	});
});

describe('interests', () => {
	it('never leave the server, signed in or out', async () => {
		for (const viewer of [null, 'me']) {
			const data = (await load(event(viewer))) as { u: { i?: string[] } };
			expect(data.u.i).toBeUndefined();
		}
	});
});
