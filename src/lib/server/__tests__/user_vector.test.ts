import { describe, it, expect, vi, beforeEach } from 'vitest';

const { ensureMock, upsertMock, retrieveOneMock, scrollMock, embedMock } = vi.hoisted(() => ({
	ensureMock: vi.fn(),
	upsertMock: vi.fn(),
	retrieveOneMock: vi.fn(),
	scrollMock: vi.fn(),
	embedMock: vi.fn()
}));

vi.mock('../qdrant', async () => {
	const actual = await vi.importActual<typeof import('../qdrant')>('../qdrant');
	return {
		...actual,
		ensure: ensureMock,
		upsert: upsertMock,
		retrieve_one: retrieveOneMock,
		scroll: scrollMock
	};
});
vi.mock('../or', () => ({ embed: embedMock }));

import { save_user, create_pw_user, patch_user } from '../user';
import { save_profile } from '../profile';
import { V, ZV } from '../qdrant';

const ENV = { QDRANT_URL: 'u', QDRANT_KEY: 'k' };
const BASE_USER = { s: 'u' as const, g: 'sub', u: 'ada', d: 1000, o: 'google' as const };
const REAL_VEC = new Array(4096).fill(0.25);

const written = () => upsertMock.mock.calls.at(-1)![1][0] as { vector: Record<string, number[]> };

beforeEach(() => {
	vi.clearAllMocks();
	ensureMock.mockResolvedValue(undefined);
	upsertMock.mockResolvedValue(undefined);
	retrieveOneMock.mockResolvedValue(null);
	scrollMock.mockResolvedValue([]);
	embedMock.mockResolvedValue(REAL_VEC);
});

describe('a user point never carries a zero vector', () => {
	it('save_user writes no vector at all for a brand-new account', async () => {
		await save_user(ENV, 'sub-1', undefined, 'ada@example.com');
		expect(written().vector).toEqual({});
		expect(embedMock).not.toHaveBeenCalled();
	});

	it('save_user PRESERVES an existing profile embedding — logging in must not wipe it', async () => {
		retrieveOneMock.mockResolvedValue({
			id: 'x',
			vector: { [V]: REAL_VEC },
			payload: { ...BASE_USER, a: 'i like boats' }
		});
		await save_user(ENV, 'sub-1', undefined, 'ada@example.com');
		expect(written().vector).toEqual({ [V]: REAL_VEC });
		expect(embedMock).not.toHaveBeenCalled();
	});

	it('create_pw_user writes no vector at all', async () => {
		await create_pw_user(ENV, 'ada@example.com', 'hunter2hunter2');
		expect(written().vector).toEqual({});
	});

	it('patch_user writes no vector when the point had none', async () => {
		retrieveOneMock.mockResolvedValue({ id: 'x', vector: undefined, payload: { ...BASE_USER } });
		await patch_user(ENV, 'x', { tz: 'UTC' });
		expect(written().vector).toEqual({});
	});

	it('patch_user keeps the point vector it found', async () => {
		retrieveOneMock.mockResolvedValue({
			id: 'x',
			vector: { [V]: REAL_VEC },
			payload: { ...BASE_USER }
		});
		await patch_user(ENV, 'x', { tz: 'UTC' });
		expect(written().vector).toEqual({ [V]: REAL_VEC });
	});
});

describe('save_profile stores the embedding of the profile text', () => {
	beforeEach(() => {
		retrieveOneMock.mockResolvedValue({ id: 'uid', payload: { ...BASE_USER } });
	});

	it('embeds about + interests and stores it under the named vector key', async () => {
		await save_profile(ENV, 'uid', { about: 'i like boats', interests: ['sailing'] });
		expect(embedMock).toHaveBeenCalledWith(
			ENV,
			'about_user: i like boats | user_interests: sailing'
		);
		expect(written().vector).toEqual({ [V]: REAL_VEC });
	});

	it('stores no vector and never embeds when about and interests are both empty', async () => {
		await save_profile(ENV, 'uid', { about: '', interests: [] });
		expect(written().vector).toEqual({});
		expect(embedMock).not.toHaveBeenCalled();
	});

	it('clearing a profile drops the vector instead of keeping a stale one', async () => {
		retrieveOneMock.mockResolvedValue({
			id: 'uid',
			vector: { [V]: REAL_VEC },
			payload: { ...BASE_USER, a: 'i like boats' }
		});
		await save_profile(ENV, 'uid', { about: '' });
		expect(written().vector).toEqual({});
	});

	it('stores no vector when the embedding provider fails and returns zeros', async () => {
		embedMock.mockResolvedValue(ZV);
		await save_profile(ENV, 'uid', { about: 'i like boats' });
		expect(written().vector).toEqual({});
	});
});
