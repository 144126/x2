import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getSecretMock, sendScheduledBatchMock } = vi.hoisted(() => ({
	getSecretMock: vi.fn(),
	sendScheduledBatchMock: vi.fn()
}));

vi.mock('$env/dynamic/private', () => ({ env: { SECRET: 'shh' } }));
vi.mock('$lib/server/qdrant', () => ({ get_secret: getSecretMock }));
vi.mock('$lib/server/scheduled', () => ({ send_scheduled_batch: sendScheduledBatchMock }));

import { POST } from '../+server';

function event(authHeader?: string) {
	return {
		request: new Request('https://x/api/cron/dispatch-scheduled', {
			method: 'POST',
			headers: authHeader ? { authorization: authHeader } : {}
		}),
		locals: { x2_ws: {} }
	} as unknown as Parameters<typeof POST>[0];
}

beforeEach(() => {
	vi.clearAllMocks();
	getSecretMock.mockResolvedValue('shh');
	sendScheduledBatchMock.mockResolvedValue(undefined);
});

describe('POST /api/cron/dispatch-scheduled', () => {
	it('401s without the shared secret', async () => {
		await expect(POST(event())).rejects.toMatchObject({ status: 401 });
		expect(sendScheduledBatchMock).not.toHaveBeenCalled();
	});

	it('401s with the wrong secret', async () => {
		await expect(POST(event('Bearer nope'))).rejects.toMatchObject({ status: 401 });
	});

	it('dispatches the batch with the right secret', async () => {
		const body = await (await POST(event('Bearer shh'))).json();
		expect(body).toEqual({ ok: true });
		expect(sendScheduledBatchMock).toHaveBeenCalled();
	});
});
