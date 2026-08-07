import { describe, it, expect, vi, beforeEach } from 'vitest';

const { decodeSessionMock, hubSvGetMock } = vi.hoisted(() => ({
	decodeSessionMock: vi.fn(),
	hubSvGetMock: vi.fn()
}));

vi.mock('$env/dynamic/private', () => ({ env: { SECRET: 's' } }));
vi.mock('$app/environment', () => ({ dev: false }));
vi.mock('$lib/server/session', () => ({ decode_session: decodeSessionMock }));
vi.mock('$lib/server/hub_client', () => ({ hub_sv_get: hubSvGetMock }));

import { handle } from '../hooks.server';

function event(platform?: unknown, session?: string) {
	const resolve = vi.fn(async () => new Response());
	return {
		event: {
			request: new Request('https://x/'),
			cookies: { get: vi.fn(() => session ?? null), set: vi.fn(), delete: vi.fn() },
			locals: {} as Record<string, unknown>,
			platform
		} as unknown as Parameters<typeof handle>[0]['event'],
		resolve
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	decodeSessionMock.mockResolvedValue(null);
	hubSvGetMock.mockResolvedValue(0);
});

describe('session signature check', () => {
	it('trusts the HMAC signature without a DO round trip', async () => {
		decodeSessionMock.mockResolvedValue({ user: { id: 'u1', username: 'a' }, v: 1 });
		const { event: e, resolve } = event({ env: { X2_WS: {} } }, 'tok');
		await handle({ event: e, resolve });
		expect(e.locals.user).toEqual({ id: 'u1', username: 'a' });
		expect(hubSvGetMock).not.toHaveBeenCalled();
	});

	it('deletes the cookie when decode_session returns null (expired/tampered)', async () => {
		decodeSessionMock.mockResolvedValue(null);
		const { event: e, resolve } = event({ env: { X2_WS: {} } }, 'tok');
		await handle({ event: e, resolve });
		expect(e.locals.user).toBeNull();
		expect(e.cookies.delete).toHaveBeenCalledWith('session', { path: '/' });
	});

	it('leaves user null with no session cookie at all', async () => {
		const { event: e, resolve } = event({ env: { X2_WS: {} } });
		await handle({ event: e, resolve });
		expect(e.locals.user).toBeNull();
		expect(e.cookies.delete).not.toHaveBeenCalled();
	});

	it('verifies the signature when X2_WS is absent (prerender)', async () => {
		decodeSessionMock.mockResolvedValue({ user: { id: 'u1', username: 'a' }, v: 0 });
		const { event: e, resolve } = event(undefined, 'tok');
		await handle({ event: e, resolve });
		expect(e.locals.user).toEqual({ id: 'u1', username: 'a' });
	});
});

describe('geo context from platform.cf', () => {
	it('reads country, region, city and timezone off platform.cf', async () => {
		const { event: e, resolve } = event({
			cf: {
				country: 'NG',
				regionCode: 'LA',
				region: 'Lagos',
				city: 'Lagos',
				timezone: 'Africa/Lagos'
			}
		});
		await handle({ event: e, resolve });
		expect(e.locals.geo).toEqual({
			country: 'NG',
			region: 'LA',
			region_name: 'Lagos',
			city: 'Lagos',
			tz: 'Africa/Lagos'
		});
		expect(resolve).toHaveBeenCalled();
	});

	it('leaves geo null with no platform', async () => {
		const { event: e, resolve } = event(undefined);
		await handle({ event: e, resolve });
		expect(e.locals.geo).toBeNull();
	});

	it('survives a platform proxy that throws', async () => {
		const platform = {};
		Object.defineProperty(platform, 'cf', {
			get: () => {
				throw new Error('proxy');
			}
		});
		const { event: e, resolve } = event(platform);
		await handle({ event: e, resolve });
		expect(e.locals.geo).toBeNull();
		expect(resolve).toHaveBeenCalled();
	});

	it('drops placeholder values', async () => {
		const { event: e, resolve } = event({
			cf: { country: 'XX', city: '' }
		});
		await handle({ event: e, resolve });
		expect(e.locals.geo).toBeNull();
	});
});
