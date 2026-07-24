import { describe, it, expect, vi, beforeEach } from 'vitest';

const { ensureMock, upsertMock, getUserMock, embedMock } = vi.hoisted(() => ({
	ensureMock: vi.fn(),
	upsertMock: vi.fn(),
	getUserMock: vi.fn(),
	embedMock: vi.fn()
}));

vi.mock('../qdrant', async () => {
	const actual = await vi.importActual<typeof import('../qdrant')>('../qdrant');
	return { ...actual, ensure: ensureMock, upsert: upsertMock };
});
vi.mock('../user', () => ({ get_user: getUserMock }));
vi.mock('../or', () => ({ embed: embedMock }));

import { save_profile } from '../profile';
import { ZV } from '../qdrant';

const ENV = { QDRANT_URL: 'u', QDRANT_KEY: 'k' };
const BASE_USER = { s: 'u' as const, g: 'sub', n: 'Ada', d: 1000, o: 'google' as const };

beforeEach(() => {
	vi.clearAllMocks();
	ensureMock.mockResolvedValue(undefined);
	upsertMock.mockResolvedValue(undefined);
	embedMock.mockResolvedValue([0.5, 0.6]);
});

describe('save_profile', () => {
	it('throws when the user does not exist', async () => {
		getUserMock.mockResolvedValue(null);
		await expect(save_profile(ENV, 'uid', { about: 'x' })).rejects.toThrow('no_user');
		expect(upsertMock).not.toHaveBeenCalled();
	});

	it('merges new fields over the existing profile, keeping untouched ones', async () => {
		getUserMock.mockResolvedValue({ ...BASE_USER, u: 'old-handle', a: 'old about', ag: 20 });
		await save_profile(ENV, 'uid', { username: 'new-handle', about: 'new about' });
		const payload = upsertMock.mock.calls[0][1][0].payload;
		expect(payload.u).toBe('new-handle');
		expect(payload.a).toBe('new about');
		expect(payload.ag).toBe(20); // untouched field preserved
		expect(payload.n).toBe('Ada'); // name preserved from cur
	});

	it('builds the embedding text from about + interests and stores it under the uid', async () => {
		getUserMock.mockResolvedValue({ ...BASE_USER });
		await save_profile(ENV, 'uid-1', { about: 'loves hiking', interests: ['trail running', 'coffee'] });
		expect(embedMock).toHaveBeenCalledWith(
			ENV,
			'about_user: loves hiking | user_interests: trail running, coffee'
		);
		const call = upsertMock.mock.calls[0];
		expect(call[1][0].id).toBe('uid-1');
		expect(call[1][0].vector).toEqual([0.5, 0.6]);
	});

	it('uses the zero vector and skips embedding when about+interests are both empty', async () => {
		getUserMock.mockResolvedValue({ ...BASE_USER });
		await save_profile(ENV, 'uid-1', { username: 'just-a-handle' });
		expect(embedMock).not.toHaveBeenCalled();
		expect(upsertMock.mock.calls[0][1][0].vector).toBe(ZV);
	});

	it('re-embeds when only interests are provided', async () => {
		getUserMock.mockResolvedValue({ ...BASE_USER });
		await save_profile(ENV, 'uid-1', { interests: ['ceramics'] });
		expect(embedMock).toHaveBeenCalledWith(ENV, 'user_interests: ceramics');
	});
});
