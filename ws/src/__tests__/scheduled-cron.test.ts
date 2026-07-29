import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getSecretMock } = vi.hoisted(() => ({ getSecretMock: vi.fn() }));

vi.mock('../../../src/lib/server/qdrant', () => ({ get_secret: getSecretMock }));

import worker from '../index';

beforeEach(() => {
	vi.clearAllMocks();
	getSecretMock.mockImplementation(async (v: unknown) => (v ? String(v) : ''));
	vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('ok')));
});

describe('scheduled cron', () => {
	it('does nothing without X2_ORIGIN configured', async () => {
		await worker.scheduled!({} as never, {} as never, {} as never);
		expect(fetch).not.toHaveBeenCalled();
	});

	it('calls the dispatch endpoint with the shared secret', async () => {
		await worker.scheduled!(
			{} as never,
			{ X2_ORIGIN: 'https://x2.example', SECRET: 'shh' } as never,
			{} as never
		);
		expect(fetch).toHaveBeenCalledWith(
			'https://x2.example/api/cron/dispatch-scheduled',
			expect.objectContaining({ method: 'POST', headers: { authorization: 'Bearer shh' } })
		);
	});
});
