import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { set_badge, sync_badge } from '../badge';

let setAppBadge: ReturnType<typeof vi.fn>;
let clearAppBadge: ReturnType<typeof vi.fn>;

beforeEach(() => {
	setAppBadge = vi.fn().mockResolvedValue(undefined);
	clearAppBadge = vi.fn().mockResolvedValue(undefined);
	vi.stubGlobal('navigator', { setAppBadge, clearAppBadge });
});

afterEach(() => vi.unstubAllGlobals());

describe('set_badge', () => {
	it('sets a positive count', async () => {
		await set_badge(3);
		expect(setAppBadge).toHaveBeenCalledWith(3);
		expect(clearAppBadge).not.toHaveBeenCalled();
	});

	it('clears at zero instead of setting 0', async () => {
		await set_badge(0);
		expect(clearAppBadge).toHaveBeenCalled();
		expect(setAppBadge).not.toHaveBeenCalled();
	});

	it('never throws when the API is missing (Firefox, older Safari)', async () => {
		vi.stubGlobal('navigator', {});
		await expect(set_badge(3)).resolves.toBeUndefined();
	});

	it('never throws when the browser rejects the call', async () => {
		setAppBadge.mockRejectedValue(new Error('denied'));
		await expect(set_badge(3)).resolves.toBeUndefined();
	});
});

describe('sync_badge', () => {
	it('fetches the unread total and sets the badge', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(new Response(JSON.stringify({ total: 5, by_conv: {} })))
		);
		expect(await sync_badge()).toBe(5);
		expect(setAppBadge).toHaveBeenCalledWith(5);
	});

	it('clears the badge when nothing is unread', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ total: 0 }))));
		expect(await sync_badge()).toBe(0);
		expect(clearAppBadge).toHaveBeenCalled();
	});

	it('tolerates a failed fetch, returning 0 rather than throwing', async () => {
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
		await expect(sync_badge()).resolves.toBe(0);
	});
});
