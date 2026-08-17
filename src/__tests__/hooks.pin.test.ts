import { describe, it, expect, vi, beforeEach } from 'vitest';

const { decode_session, SECRET } = vi.hoisted(() => ({
	decode_session: vi.fn(),
	SECRET: 'a-server-secret-long-enough-to-key'
}));
vi.mock('$env/dynamic/private', () => ({ env: { SECRET } }));
vi.mock('$app/environment', () => ({ dev: true }));
vi.mock('$lib/server/session', async () => {
	const real =
		await vi.importActual<typeof import('../lib/server/session')>('../lib/server/session');
	return { ...real, decode_session };
});

import { handle } from '../hooks.server';
import { encode_unlock } from '../lib/server/pin';

const USER = { id: 'u-1', username: 'ada' };

function event(path: string, cookies: Record<string, string>, opts: { html?: boolean } = {}) {
	const jar = { ...cookies };
	return {
		url: new URL(`https://x2.test${path}`),
		isDataRequest: false,
		request: new Request(`https://x2.test${path}`, {
			headers: opts.html === false ? {} : { accept: 'text/html' }
		}),
		platform: undefined,
		locals: {} as App.Locals,
		cookies: {
			get: (k: string) => jar[k],
			set: (k: string, v: string) => (jar[k] = v),
			delete: (k: string) => delete jar[k]
		},
		jar
	};
}

const resolve = vi.fn(async () => new Response('ok'));

async function run(e: ReturnType<typeof event>) {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return handle({ event: e as any, resolve } as any);
}

async function caught(e: ReturnType<typeof event>) {
	try {
		await run(e);
		return null;
	} catch (err) {
		return err as { status: number; location?: string; body?: { message: string } };
	}
}

beforeEach(() => {
	vi.clearAllMocks();
	resolve.mockResolvedValue(new Response('ok'));
});

describe('the app lock, from the outside', () => {
	it('lets a signed-in account with no pin straight through', async () => {
		decode_session.mockResolvedValue({ user: USER, v: 0, pin: 0 });
		const e = event('/chats', { session: 's' });
		expect((await run(e)).status).toBe(200);
		expect(e.locals.pin_locked).toBe(false);
	});

	it('sends a locked browser to the lock screen instead of the page it asked for', async () => {
		decode_session.mockResolvedValue({ user: USER, v: 0, pin: 2 });
		const err = await caught(event('/chats', { session: 's' }));
		expect(err?.status).toBe(302);
		expect(err?.location).toBe('/lock?r=%2Fchats');
		expect(resolve).not.toHaveBeenCalled();
	});

	it('refuses an api call outright rather than redirecting it', async () => {
		decode_session.mockResolvedValue({ user: USER, v: 0, pin: 2 });
		const err = await caught(event('/api/messages', { session: 's' }, { html: false }));
		expect(err?.status).toBe(423);
		expect(resolve).not.toHaveBeenCalled();
	});

	it('refuses media, so a cached image url is not a peephole', async () => {
		decode_session.mockResolvedValue({ user: USER, v: 0, pin: 2 });
		expect((await caught(event('/media/k', { session: 's' }, { html: false })))?.status).toBe(423);
	});

	it('still serves the lock screen and the unlock call', async () => {
		decode_session.mockResolvedValue({ user: USER, v: 0, pin: 2 });
		for (const p of ['/lock', '/api/pin/unlock', '/logout', '/google'])
			expect((await run(event(p, { session: 's' }))).status).toBe(200);
	});

	it('opens for a valid unlock cookie', async () => {
		decode_session.mockResolvedValue({ user: USER, v: 0, pin: 2 });
		const pin = await encode_unlock(SECRET, USER.id, 2);
		const e = event('/chats', { session: 's', pin });
		expect((await run(e)).status).toBe(200);
		expect(e.locals.pin_locked).toBe(false);
	});

	it('slides the idle window forward on every request that gets through', async () => {
		decode_session.mockResolvedValue({ user: USER, v: 0, pin: 2 });
		const pin = await encode_unlock(SECRET, USER.id, 2, Date.now() - 60_000);
		const e = event('/chats', { session: 's', pin });
		await run(e);
		expect(e.jar.pin).not.toBe(pin);
	});

	it('stays locked when the pin changed after that cookie was issued', async () => {
		decode_session.mockResolvedValue({ user: USER, v: 0, pin: 3 });
		const pin = await encode_unlock(SECRET, USER.id, 2);
		const e = event('/chats', { session: 's', pin });
		expect((await caught(e))?.status).toBe(302);
		expect(e.jar.pin).toBeUndefined();
	});

	it('stays locked for a cookie minted for someone else', async () => {
		decode_session.mockResolvedValue({ user: USER, v: 0, pin: 2 });
		const pin = await encode_unlock(SECRET, 'u-2', 2);
		expect((await caught(event('/chats', { session: 's', pin })))?.status).toBe(302);
	});

	it('stays locked for an expired cookie', async () => {
		decode_session.mockResolvedValue({ user: USER, v: 0, pin: 2 });
		const pin = await encode_unlock(SECRET, USER.id, 2, Date.now() - 86_400_000);
		expect((await caught(event('/chats', { session: 's', pin })))?.status).toBe(302);
	});

	it('stays locked for a cookie signed with the wrong key', async () => {
		decode_session.mockResolvedValue({ user: USER, v: 0, pin: 2 });
		const pin = await encode_unlock('some-other-secret-entirely', USER.id, 2);
		expect((await caught(event('/chats', { session: 's', pin })))?.status).toBe(302);
	});
});

describe('what the service worker is told', () => {
	it('marks responses so the worker stops caching once a pin exists', async () => {
		decode_session.mockResolvedValue({ user: USER, v: 0, pin: 2 });
		const pin = await encode_unlock(SECRET, USER.id, 2);
		expect((await run(event('/chats', { session: 's', pin }))).headers.get('x-pin')).toBe('1');
	});

	it('marks them the other way when there is no pin, so the worker can cache again', async () => {
		decode_session.mockResolvedValue({ user: USER, v: 0, pin: 0 });
		expect((await run(event('/chats', { session: 's' }))).headers.get('x-pin')).toBe('0');
	});

	it('says nothing to a signed-out visitor', async () => {
		decode_session.mockResolvedValue(null);
		expect((await run(event('/', {}))).headers.get('x-pin')).toBeNull();
	});
});
