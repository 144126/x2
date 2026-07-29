import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
	createPwUserMock,
	getUserMock,
	uuidFromMock,
	attributeReferralMock,
	ensurePartnerCodeMock,
	encodeSessionMock
} = vi.hoisted(() => ({
	createPwUserMock: vi.fn(),
	getUserMock: vi.fn(),
	uuidFromMock: vi.fn(),
	attributeReferralMock: vi.fn(),
	ensurePartnerCodeMock: vi.fn(),
	encodeSessionMock: vi.fn()
}));

vi.mock('$env/dynamic/private', () => ({ env: { SECRET: 's' } }));
vi.mock('$lib/server/user', () => ({
	create_pw_user: createPwUserMock,
	get_user: getUserMock
}));
vi.mock('$lib/server/qdrant', () => ({ uuid_from: uuidFromMock }));
vi.mock('$lib/server/partner', () => ({
	attribute_referral: attributeReferralMock,
	ensure_partner_code: ensurePartnerCodeMock
}));
vi.mock('$lib/server/session', () => ({ encode_session: encodeSessionMock }));

import { POST } from '../+server';

function event(body: unknown, cookie_ref?: string) {
	const cookies = {
		get: vi.fn((k: string) => (k === 'ref_code' ? cookie_ref : undefined)),
		set: vi.fn(),
		delete: vi.fn()
	};
	return {
		request: { json: async () => body },
		cookies
	} as unknown as Parameters<typeof POST>[0];
}

beforeEach(() => {
	vi.clearAllMocks();
	uuidFromMock.mockResolvedValue('new-uid');
	getUserMock.mockResolvedValue(null);
	createPwUserMock.mockResolvedValue('new-uid');
	attributeReferralMock.mockResolvedValue({ ok: true, inviter: 'bob' });
	ensurePartnerCodeMock.mockResolvedValue('abc123');
	encodeSessionMock.mockResolvedValue('sess');
});

describe('POST /api/auth/register', () => {
	it('attributes a new signup when a partner code is provided', async () => {
		const res = await POST(event({ e: 'a@x.com', p: 'hunter2', c: 'CODE1' }));
		expect(res.status).toBe(200);
		expect(attributeReferralMock).toHaveBeenCalledWith(expect.anything(), 'new-uid', 'CODE1');
		expect(ensurePartnerCodeMock).toHaveBeenCalledWith(expect.anything(), 'new-uid');
	});

	it('reads the partner code from the ref_code cookie when body omits it', async () => {
		await POST(event({ e: 'a@x.com', p: 'hunter2' }, 'fromcookie'));
		expect(attributeReferralMock).toHaveBeenCalledWith(expect.anything(), 'new-uid', 'fromcookie');
	});

	it('does not re-attribute an existing account on re-register', async () => {
		getUserMock.mockResolvedValue({ s: 'u', u: 'ada', d: 1 });
		await POST(event({ e: 'a@x.com', p: 'hunter2', c: 'CODE1' }));
		expect(attributeReferralMock).not.toHaveBeenCalled();
		expect(ensurePartnerCodeMock).toHaveBeenCalled();
	});

	it('still assigns a partner code when no referral code is present', async () => {
		await POST(event({ e: 'a@x.com', p: 'hunter2' }));
		expect(attributeReferralMock).not.toHaveBeenCalled();
		expect(ensurePartnerCodeMock).toHaveBeenCalledWith(expect.anything(), 'new-uid');
	});
});
