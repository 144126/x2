import { describe, it, expect, vi, beforeEach } from 'vitest';

const { findUserByEmailMock, patchUserMock, uuidFromMock, hashPwMock, encodeSessionMock } = vi.hoisted(
	() => ({
		findUserByEmailMock: vi.fn(),
		patchUserMock: vi.fn(),
		uuidFromMock: vi.fn(),
		hashPwMock: vi.fn(),
		encodeSessionMock: vi.fn()
	})
);

vi.mock('$env/dynamic/private', () => ({ env: { SECRET: 's' } }));
vi.mock('$lib/server/user', () => ({
	find_user_by_email: findUserByEmailMock,
	patch_user: patchUserMock
}));
vi.mock('$lib/server/qdrant', () => ({ uuid_from: uuidFromMock }));
vi.mock('$lib/server/pw', () => ({ hash_pw: hashPwMock }));
vi.mock('$lib/server/session', () => ({ encode_session: encodeSessionMock }));

import { POST } from '../+server';

function event(body: unknown, uid: string | null = 'me') {
	const cookies = { get: vi.fn(), set: vi.fn(), delete: vi.fn() };
	return {
		request: {
			json: async () => body
		},
		locals: { user: uid ? { id: uid, username: 'Me' } : null },
		cookies
	} as unknown as Parameters<typeof POST>[0];
}

beforeEach(() => {
	vi.clearAllMocks();
	uuidFromMock.mockResolvedValue('legacy-uid');
	findUserByEmailMock.mockResolvedValue(null);
	patchUserMock.mockResolvedValue({ s: 'u', u: 'Me', m: 'e@x.com', d: 1 });
	hashPwMock.mockResolvedValue('hashed');
	encodeSessionMock.mockResolvedValue('sess');
});

describe('POST /api/auth/set-password', () => {
	it('401s when signed out', async () => {
		await expect(POST(event({ email: 'e@x.com', password: 'hunter22' }, null))).rejects.toMatchObject({
			status: 401
		});
	});

	it('400s on a short password', async () => {
		await expect(POST(event({ email: 'e@x.com', password: 'short' }))).rejects.toMatchObject({
			status: 400
		});
		expect(patchUserMock).not.toHaveBeenCalled();
	});

	it('409s when the email already belongs to a different account id', async () => {
		findUserByEmailMock.mockResolvedValue({ id: 'someone-else', s: 'u', u: 'other', d: 1 });
		await expect(POST(event({ email: 'e@x.com', password: 'hunter22' }))).rejects.toMatchObject({
			status: 409
		});
		expect(patchUserMock).not.toHaveBeenCalled();
	});

	it('attaches the password to the CURRENT session id, never a re-derived one', async () => {
		const res = await POST(event({ email: 'e@x.com', password: 'hunter22' }));
		expect(res.status).toBe(200);
		expect(patchUserMock).toHaveBeenCalledWith(expect.anything(), 'me', {
			m: 'e@x.com',
			h: 'hashed',
			o: 'local'
		});
	});

	it('sets a fresh session cookie on success', async () => {
		const ev = event({ email: 'e@x.com', password: 'hunter22' });
		await POST(ev);
		expect(encodeSessionMock).toHaveBeenCalledWith(expect.anything(), {
			id: 'me',
			username: 'Me',
			email: 'e@x.com',
			is_device: false
		});
		expect(ev.cookies.set).toHaveBeenCalledWith('session', 'sess', expect.objectContaining({ path: '/' }));
	});
});
