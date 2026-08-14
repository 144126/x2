import { describe, it, expect, vi, beforeEach } from 'vitest';

const { svMock, decodeMock } = vi.hoisted(() => ({
	svMock: vi.fn(async () => 0),
	decodeMock: vi.fn(async () => ({ user: { id: 'u1', n: 'ed' }, v: 0 }))
}));

vi.mock('$lib/server/hub_client', async () => {
	const actual =
		await vi.importActual<typeof import('$lib/server/hub_client')>('$lib/server/hub_client');
	return { ...actual, hub_sv_get: svMock };
});
vi.mock('$lib/server/session', async () => {
	const actual = await vi.importActual<typeof import('$lib/server/session')>('$lib/server/session');
	return { ...actual, decode_session: decodeMock };
});
vi.mock('$app/environment', () => ({ dev: false, browser: false, building: false }));
vi.mock('$env/dynamic/private', () => ({ env: { SECRET: 'a-test-secret-at-least-32-bytes' } }));

import { handle } from '../hooks.server';

function evt(session?: string) {
	const jar = new Map<string, string>();
	if (session) jar.set('session', session);
	return {
		cookies: {
			get: (k: string) => jar.get(k),
			set: (k: string, v: string) => jar.set(k, v),
			delete: (k: string) => jar.delete(k)
		},
		platform: { env: { X2_WS: { fetch: vi.fn() } } },
		locals: {} as Record<string, unknown>,
		url: new URL('https://x2.local/find')
	} as never;
}

const resolve = vi.fn(async () => new Response('ok'));

describe('handle does no durable object round trip', () => {
	beforeEach(() => {
		svMock.mockClear();
		decodeMock.mockClear();
		resolve.mockClear();
	});

	it('never calls hub_sv_get for a signed-in request', async () => {
		await handle({ event: evt('signed-cookie'), resolve } as never);
		expect(svMock).not.toHaveBeenCalled();
	});

	it('never calls hub_sv_get for an anonymous request', async () => {
		await handle({ event: evt(), resolve } as never);
		expect(svMock).not.toHaveBeenCalled();
	});

	it('still populates locals.user from the signature alone', async () => {
		const event = evt('signed-cookie');
		await handle({ event, resolve } as never);
		expect((event as unknown as { locals: { user: { id: string } | null } }).locals.user).toEqual({
			id: 'u1',
			n: 'ed'
		});
	});

	it('still clears the cookie when the signature does not verify', async () => {
		decodeMock.mockResolvedValueOnce(null as never);
		const event = evt('tampered');
		await handle({ event, resolve } as never);
		expect((event as unknown as { locals: { user: unknown } }).locals.user).toBeNull();
		expect(
			(event as unknown as { cookies: { get: (k: string) => string | undefined } }).cookies.get(
				'session'
			)
		).toBeUndefined();
	});

	it('verifies the session exactly once per request', async () => {
		await handle({ event: evt('signed-cookie'), resolve } as never);
		expect(decodeMock).toHaveBeenCalledTimes(1);
	});

	it('always resolves the request', async () => {
		await handle({ event: evt('signed-cookie'), resolve } as never);
		expect(resolve).toHaveBeenCalledTimes(1);
	});
});
