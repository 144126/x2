import { describe, it, expect, vi, beforeEach } from 'vitest';

const { listScheduledMock, cancelScheduledMock } = vi.hoisted(() => ({
	listScheduledMock: vi.fn(),
	cancelScheduledMock: vi.fn()
}));

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$lib/server/scheduled', () => ({
	list_scheduled: listScheduledMock,
	cancel_scheduled: cancelScheduledMock
}));

import { GET, DELETE } from '../+server';

function event(uid: string | null, id?: string) {
	return {
		locals: { user: uid ? { id: uid, username: 'ada' } : null },
		url: new URL(`https://x/api/scheduled${id ? `?id=${id}` : ''}`)
	} as unknown as Parameters<typeof GET>[0];
}

beforeEach(() => {
	vi.clearAllMocks();
	listScheduledMock.mockResolvedValue([{ id: '1', at: 1 }]);
	cancelScheduledMock.mockResolvedValue(true);
});

describe('GET /api/scheduled', () => {
	it('401s when signed out', async () => {
		await expect(GET(event(null))).rejects.toMatchObject({ status: 401 });
	});

	it("lists the caller's pending scheduled messages", async () => {
		const body = await (await GET(event('ada'))).json();
		expect(body.scheduled).toHaveLength(1);
		expect(listScheduledMock).toHaveBeenCalledWith({}, 'ada');
	});
});

describe('DELETE /api/scheduled', () => {
	it('401s when signed out', async () => {
		await expect(DELETE(event(null, '1'))).rejects.toMatchObject({ status: 401 });
	});

	it('400s without an id', async () => {
		await expect(DELETE(event('ada'))).rejects.toMatchObject({ status: 400 });
	});

	it('404s when cancellation fails (not found or not owner)', async () => {
		cancelScheduledMock.mockResolvedValue(false);
		await expect(DELETE(event('ada', '1'))).rejects.toMatchObject({ status: 404 });
	});

	it('cancels on success', async () => {
		const body = await (await DELETE(event('ada', '1'))).json();
		expect(body).toEqual({ ok: true });
		expect(cancelScheduledMock).toHaveBeenCalledWith({}, 'ada', '1');
	});
});
