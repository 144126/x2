import { describe, it, expect, vi, beforeEach } from 'vitest';
const { getUserMock, saveUserMock, encodeSessionMock, guardMock } = vi.hoisted(() => ({
	getUserMock: vi.fn(),
	saveUserMock: vi.fn(),
	encodeSessionMock: vi.fn(),
	guardMock: vi.fn()
}));
vi.mock('../user', async (importOriginal) => ({
	...(await importOriginal<typeof import('../user')>()),
	get_user: getUserMock,
	save_user: saveUserMock
}));
vi.mock('../session', () => ({ encode_session: encodeSessionMock }));
vi.mock('../rl', () => ({ guard: guardMock }));
import { get_or_create_device_user, ensure_device_session } from '../device';

beforeEach(() => vi.clearAllMocks());

describe('get_or_create_device_user', () => {
	it('returns the existing record when one is already at the derived id', async () => {
		getUserMock.mockResolvedValue({ u: 'someone', h: undefined, o: 'device' });
		const u = await get_or_create_device_user({} as never, 'dev-1');
		expect(saveUserMock).not.toHaveBeenCalled();
		expect(u.u).toBe('someone');
	});
	it('creates a device user when none exists yet', async () => {
		getUserMock
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce({ u: 'fresh', h: undefined, o: 'device' });
		await get_or_create_device_user({} as never, 'dev-2');
		expect(saveUserMock).toHaveBeenCalledWith({}, 'dev-2', undefined, undefined, 'device');
	});
});

describe('ensure_device_session', () => {
	it('returns the existing session user without any DB call when already logged in', async () => {
		const locals = { user: { id: 'u1', username: 'u1' }, device_id: 'dev-1' } as never;
		const r = await ensure_device_session(
			{} as never,
			undefined,
			locals,
			{} as never,
			() => '1.2.3.4'
		);
		expect(r).toEqual({ id: 'u1', username: 'u1' });
		expect(guardMock).not.toHaveBeenCalled();
	});
	it('returns null when there is no device_id cookie at all', async () => {
		const locals = { user: null, device_id: undefined } as never;
		const r = await ensure_device_session(
			{} as never,
			undefined,
			locals,
			{} as never,
			() => '1.2.3.4'
		);
		expect(r).toBeNull();
	});
	it('rate-limits by IP before creating a device account', async () => {
		const locals = { user: null, device_id: 'dev-3' } as never;
		getUserMock
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce({ u: 'x', h: undefined, o: 'device' });
		const cookies = { set: vi.fn() } as never;
		await ensure_device_session(
			{ SECRET: 's' } as never,
			undefined,
			locals,
			cookies,
			() => '9.9.9.9'
		);
		expect(guardMock).toHaveBeenCalledWith(undefined, 'RL_DEVICE_CREATE', '9.9.9.9');
	});
	it('marks the session is_device:false when the found record already has a password (session-expired-but-device-cookie-survived case)', async () => {
		const locals = { user: null, device_id: 'dev-4' } as never;
		getUserMock.mockResolvedValue({ u: 'linked', h: 'somehash', o: 'local' });
		const cookies = { set: vi.fn() } as never;
		await ensure_device_session(
			{ SECRET: 's' } as never,
			undefined,
			locals,
			cookies,
			() => '1.1.1.1'
		);
		expect(encodeSessionMock).toHaveBeenCalledWith(
			's',
			expect.objectContaining({ is_device: false })
		);
	});
});
