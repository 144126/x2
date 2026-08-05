import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ws_on, _reset } from '$lib/ws';

// retry() is module-private, so drive it the way a real client does: /api/wstoken fails,
// open() calls retry(), and the scheduled delay is whatever setTimeout was handed.
async function next_delay(): Promise<number> {
	const spy = vi.spyOn(globalThis, 'setTimeout');
	spy.mockClear();
	const off = ws_on(() => {});
	await vi.waitFor(() => expect(spy).toHaveBeenCalled());
	const delay = spy.mock.calls.at(-1)![1] as number;
	off();
	return delay;
}

describe('reconnect backoff jitter', () => {
	beforeEach(() => {
		_reset();
		vi.stubGlobal('window', {});
		vi.stubGlobal('fetch', vi.fn(async () => new Response('no', { status: 500 })));
	});

	afterEach(() => {
		_reset();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it('waits half the window when random() is 0', async () => {
		vi.spyOn(Math, 'random').mockReturnValue(0);
		expect(await next_delay()).toBe(250);
	});

	it('approaches the full window as random() approaches 1', async () => {
		vi.spyOn(Math, 'random').mockReturnValue(0.999999);
		const d = await next_delay();
		expect(d).toBeGreaterThan(499);
		expect(d).toBeLessThanOrEqual(500);
	});

	it('never returns the same delay for two different random draws', async () => {
		vi.spyOn(Math, 'random').mockReturnValueOnce(0).mockReturnValueOnce(0.5);
		const a = await next_delay();
		const b = await next_delay();
		expect(a).not.toBe(b);
	});

	it('still doubles: the floor of each window is twice the last', async () => {
		vi.spyOn(Math, 'random').mockReturnValue(0);
		expect(await next_delay()).toBe(250);
		expect(await next_delay()).toBe(500);
		expect(await next_delay()).toBe(1000);
	});

	it('still clamps at 30s after many attempts', async () => {
		vi.spyOn(Math, 'random').mockReturnValue(0);
		let d = 0;
		for (let i = 0; i < 12; i++) d = await next_delay();
		expect(d).toBe(15_000);
	});

	it('never schedules longer than the 30s ceiling', async () => {
		vi.spyOn(Math, 'random').mockReturnValue(0.999999);
		let d = 0;
		for (let i = 0; i < 12; i++) d = await next_delay();
		expect(d).toBeLessThanOrEqual(30_000);
	});
});
