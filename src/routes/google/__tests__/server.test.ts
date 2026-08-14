import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
	saveUserMock,
	getUserMock,
	patchUserMock,
	findUserByGoogleSubMock,
	uuidFromMock,
	attributeReferralMock,
	ensurePartnerCodeMock,
	encodeSessionMock
} = vi.hoisted(() => ({
	saveUserMock: vi.fn(),
	getUserMock: vi.fn(),
	patchUserMock: vi.fn(),
	findUserByGoogleSubMock: vi.fn(),
	uuidFromMock: vi.fn(),
	attributeReferralMock: vi.fn(),
	ensurePartnerCodeMock: vi.fn(),
	encodeSessionMock: vi.fn()
}));

vi.mock('$env/dynamic/private', () => ({ env: { SECRET: 's' } }));
vi.mock('arctic', () => ({
	Google: class {
		validateAuthorizationCode() {
			return { accessToken: () => 'tok' };
		}
		createAuthorizationURL() {
			return new URL('https://accounts.google.com/auth');
		}
	},
	generateState: () => 'st',
	generateCodeVerifier: () => 'vc'
}));
vi.mock('$lib/server/qdrant', () => ({
	get_secret: vi.fn(async () => 'x'),
	uuid_from: uuidFromMock
}));
vi.mock('$lib/server/user', () => ({
	save_user: saveUserMock,
	get_user: getUserMock,
	patch_user: patchUserMock,
	find_user_by_google_sub: findUserByGoogleSubMock
}));
vi.mock('$lib/server/session', () => ({ encode_session: encodeSessionMock }));
vi.mock('$lib/server/partner', () => ({
	attribute_referral: attributeReferralMock,
	ensure_partner_code: ensurePartnerCodeMock
}));

import { GET } from '../+server';

const gu = { sub: 'google-sub-9', picture: 'pic.png', email: 'ada@gmail.com' };

function callbackEvent(device: boolean) {
	const cookies = {
		get: vi.fn((k: string) =>
			k === 'oauth_state' ? 'st' : k === 'oauth_verifier' ? 'vc' : undefined
		),
		set: vi.fn(),
		delete: vi.fn()
	};
	return {
		url: new URL('https://x/google?code=abc&state=st'),
		cookies,
		locals: { user: device ? { id: 'dev-uid', username: 'ada', is_device: true } : null }
	} as unknown as Parameters<typeof GET>[0];
}

beforeEach(() => {
	vi.clearAllMocks();
	globalThis.fetch = vi.fn(
		async () =>
			new Response(JSON.stringify(gu), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			})
	) as unknown as typeof fetch;
	uuidFromMock.mockResolvedValue('derived-uid');
	getUserMock.mockResolvedValue(null);
	findUserByGoogleSubMock.mockResolvedValue(null);
	patchUserMock.mockResolvedValue({ s: 'u', u: 'ada', d: 1 });
	saveUserMock.mockResolvedValue('derived-uid');
	encodeSessionMock.mockResolvedValue('sess');
	attributeReferralMock.mockResolvedValue({ ok: true });
	ensurePartnerCodeMock.mockResolvedValue('code');
});

describe('GET /google — linking a device account', () => {
	it('patches the device account in place, keeping its id, with no referral attribution', async () => {
		await expect(GET(callbackEvent(true))).rejects.toMatchObject({
			status: 302,
			location: '/find'
		});
		expect(patchUserMock).toHaveBeenCalledWith(expect.anything(), 'dev-uid', {
			gl: 'google-sub-9',
			p: 'pic.png',
			m: 'ada@gmail.com',
			o: 'google'
		});
		expect(saveUserMock).not.toHaveBeenCalled();
		expect(attributeReferralMock).not.toHaveBeenCalled();
		expect(encodeSessionMock).toHaveBeenCalledWith(expect.anything(), {
			id: 'dev-uid',
			username: 'ada',
			picture: 'pic.png',
			email: 'ada@gmail.com',
			is_device: false
		});
	});
});

describe('GET /google — fresh login/signup', () => {
	it('bounces a non-device logged-in user away from the start leg', async () => {
		const event = {
			url: new URL('https://x/google'),
			cookies: { get: vi.fn(), set: vi.fn(), delete: vi.fn() },
			locals: { user: { id: 'real', username: 'ada' } }
		} as unknown as Parameters<typeof GET>[0];
		await expect(GET(event)).rejects.toMatchObject({ status: 302, location: '/find' });
	});

	it('logs a returning visitor into the account already linked to their sub, not a fresh derived id', async () => {
		findUserByGoogleSubMock.mockResolvedValue({
			id: 'linked-uid',
			s: 'u',
			u: 'ada',
			d: 1,
			g: 'device-xyz',
			gl: 'google-sub-9'
		});
		await expect(GET(callbackEvent(false))).rejects.toMatchObject({
			status: 302,
			location: '/find'
		});
		expect(encodeSessionMock).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ id: 'linked-uid' })
		);
		expect(saveUserMock).not.toHaveBeenCalled();
	});

	it('creates a fresh account at the derived id for a brand-new sub', async () => {
		await expect(GET(callbackEvent(false))).rejects.toMatchObject({
			status: 302,
			location: '/find'
		});
		expect(saveUserMock).toHaveBeenCalledWith(
			expect.anything(),
			'google-sub-9',
			'pic.png',
			'ada@gmail.com',
			'google'
		);
		expect(ensurePartnerCodeMock).toHaveBeenCalled();
	});
});
