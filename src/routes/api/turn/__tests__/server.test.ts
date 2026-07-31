import { describe, it, expect, vi, beforeEach } from 'vitest';

const turnFetchMock = vi.hoisted(() => vi.fn());

vi.mock('$env/dynamic/private', () => ({
	env: { SECRET: 's', TURN_KEY_ID: 'key-123', TURN_KEY_API_TOKEN: 'tok-456' }
}));

import { POST } from '../+server';

function event(user: { id: string } | null) {
	return {
		locals: { user },
		platform: { env: {} }
	} as never;
}

beforeEach(() => {
	turnFetchMock.mockReset();
	vi.stubGlobal('fetch', turnFetchMock);
});

describe('POST /api/turn', () => {
	it('401s without a session', async () => {
		await expect(POST(event(null))).rejects.toMatchObject({ status: 401 });
	});

	it('returns the upstream iceServers on success', async () => {
		const expected = [{ urls: 'turn:example.com', username: 'u', credential: 'p' }];
		turnFetchMock.mockResolvedValue({
			ok: true,
			json: async () => ({ iceServers: expected })
		});
		const res = await POST(event({ id: 'u1' }));
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.iceServers).toEqual(expected);
	});

	it('POSTs to the correct TURN endpoint with a 600s TTL', async () => {
		turnFetchMock.mockResolvedValue({
			ok: true,
			json: async () => ({ iceServers: [] })
		});
		await POST(event({ id: 'u1' }));
		expect(turnFetchMock).toHaveBeenCalledWith(
			'https://rtc.live.cloudflare.com/v1/turn/keys/key-123/credentials/generate',
			expect.objectContaining({
				method: 'POST',
				body: JSON.stringify({ ttl: 600 })
			})
		);
	});

	it('returns a clean error when upstream responds with non-2xx', async () => {
		turnFetchMock.mockResolvedValue({
			ok: false,
			status: 403,
			text: async () => 'forbidden'
		});
		const res = await POST(event({ id: 'u1' }));
		expect(res.status).toBe(503);
		const body = await res.json();
		expect(body.error).toBe('turn_unavailable');
	});

	it('returns a clean error when upstream fetch throws', async () => {
		turnFetchMock.mockRejectedValue(new Error('network error'));
		const res = await POST(event({ id: 'u1' }));
		expect(res.status).toBe(503);
		const body = await res.json();
		expect(body.error).toBe('turn_unavailable');
	});
});
