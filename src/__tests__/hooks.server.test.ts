import { describe, it, expect, vi, beforeEach } from 'vitest';

const { decodeSessionMock } = vi.hoisted(() => ({
	decodeSessionMock: vi.fn()
}));

vi.mock('$env/dynamic/private', () => ({ env: { SECRET: 's' } }));
vi.mock('$app/environment', () => ({ dev: false }));
vi.mock('$lib/server/session', () => ({ decode_session: decodeSessionMock }));

import { handle } from '../hooks.server';

function event(platform?: unknown) {
	const resolve = vi.fn(async () => new Response());
	return {
		event: {
			request: new Request('https://x/'),
			cookies: { get: vi.fn(() => null), delete: vi.fn() },
			locals: {} as Record<string, unknown>,
			platform
		} as unknown as Parameters<typeof handle>[0]['event'],
		resolve
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	decodeSessionMock.mockResolvedValue(null);
});

describe('geo context from platform.cf', () => {
	it('reads country, region, city and timezone off platform.cf', async () => {
		const { event: e, resolve } = event({
			cf: { country: 'NG', regionCode: 'LA', region: 'Lagos', city: 'Lagos', timezone: 'Africa/Lagos' }
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
		Object.defineProperty(platform, 'cf', { get: () => { throw new Error('proxy'); } });
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
