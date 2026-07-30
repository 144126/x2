import { describe, it, expect, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$lib/server/session', () => ({ decode_session: () => Promise.resolve(null) }));

import { handle } from '../../hooks.server';

const run = async (platform: unknown) => {
	let captured: App.Locals['bg'] | undefined;
	const event = {
		cookies: { get: () => undefined, delete: () => {} },
		locals: {} as App.Locals,
		platform,
		url: new URL('https://x/')
	};
	await handle({
		event: event as never,
		resolve: async () => {
			captured = event.locals.bg;
			return new Response('ok');
		}
	} as never);
	return captured!;
};

describe('locals.bg', () => {
	it('registers the task with waitUntil when a ctx exists', async () => {
		const waitUntil = vi.fn();
		const bg = await run({ ctx: { waitUntil }, env: {}, cf: undefined });
		bg(Promise.resolve(1));
		expect(waitUntil).toHaveBeenCalledOnce();
	});

	it('swallows rejections so waitUntil never sees a rejected promise', async () => {
		const waitUntil = vi.fn();
		const bg = await run({ ctx: { waitUntil }, env: {}, cf: undefined });
		bg(Promise.reject(new Error('boom')));
		await expect(waitUntil.mock.calls[0][0]).resolves.toBeUndefined();
	});

	it('does not throw when there is no platform at all (prerender)', async () => {
		const bg = await run(undefined);
		expect(() => bg(Promise.resolve(1))).not.toThrow();
	});
});
