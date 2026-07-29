import { describe, it, expect, vi, beforeEach } from 'vitest';

const { ensureMock, upsertMock, scrollMock, getUserMock, embedMock } = vi.hoisted(() => ({
	ensureMock: vi.fn(),
	upsertMock: vi.fn(),
	scrollMock: vi.fn(),
	getUserMock: vi.fn(),
	embedMock: vi.fn()
}));

vi.mock('../qdrant', async () => {
	const actual = await vi.importActual<typeof import('../qdrant')>('../qdrant');
	return { ...actual, ensure: ensureMock, upsert: upsertMock, scroll: scrollMock };
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
	scrollMock.mockResolvedValue([]); // username uniqueness lookup: nothing taken
});

describe('save_profile', () => {
	it('throws when the user does not exist', async () => {
		getUserMock.mockResolvedValue(null);
		await expect(save_profile(ENV, 'uid', { about: 'x' })).rejects.toThrow('no_user');
		expect(upsertMock).not.toHaveBeenCalled();
	});

	it('merges new fields over the existing profile, keeping untouched ones', async () => {
		getUserMock.mockResolvedValue({ ...BASE_USER, u: 'old_handle', a: 'old about', ag: 20 });
		await save_profile(ENV, 'uid', { username: 'new_handle', about: 'new about' });
		const payload = upsertMock.mock.calls[0][1][0].payload;
		expect(payload.u).toBe('new_handle');
		expect(payload.a).toBe('new about');
		expect(payload.ag).toBe(20); // untouched field preserved
		expect(payload.n).toBe('Ada'); // name preserved from cur
	});

	it('extends to cover user display with username', async () => {
		getUserMock.mockResolvedValue({ ...BASE_USER, u: 'user123' });
		await save_profile(ENV, 'uid', { about: 'test' });
		const payload = upsertMock.mock.calls[0][1][0].payload;
		expect(payload.u).toBe('user123');
		expect(payload.a).toBe('test');
		expect(payload.n).toBe('Ada');
		// Profile should display username, not full name
	});
});

describe('show_interests flag', () => {
	it('persists the flag when explicitly turned on', async () => {
		getUserMock.mockResolvedValue({ ...BASE_USER, u: 'ada' });
		await save_profile(ENV, 'uid', { show_interests: true });
		expect(upsertMock.mock.calls[0][1][0].payload.si).toBe(true);
	});

	it('persists an explicit false rather than falling back to the stored value', async () => {
		getUserMock.mockResolvedValue({ ...BASE_USER, u: 'ada', si: true });
		await save_profile(ENV, 'uid', { show_interests: false });
		expect(upsertMock.mock.calls[0][1][0].payload.si).toBe(false);
	});

	it('leaves the stored flag alone when the field is omitted', async () => {
		getUserMock.mockResolvedValue({ ...BASE_USER, u: 'ada', si: true });
		await save_profile(ENV, 'uid', { about: 'hello' });
		expect(upsertMock.mock.calls[0][1][0].payload.si).toBe(true);
	});

	it('keeps interests in the search embedding even when the flag is off', async () => {
		getUserMock.mockResolvedValue({ ...BASE_USER, u: 'ada', i: ['jazz'] });
		await save_profile(ENV, 'uid', { show_interests: false });
		expect(embedMock).toHaveBeenCalledWith(ENV, expect.stringContaining('user_interests: jazz'));
	});
});
