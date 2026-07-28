import { describe, it, expect, vi, beforeEach } from 'vitest';

const { saveMock, deleteMock, listMock } = vi.hoisted(() => ({
	saveMock: vi.fn(),
	deleteMock: vi.fn(),
	listMock: vi.fn()
}));

const vapid_env = { VAPID_PUBLIC: 'BPublicKey', VAPID_PRIVATE: 'priv', VAPID_SUBJECT: 'mailto:a@b' };
const dynamic_env: Record<string, string> = { ...vapid_env };

vi.mock('$env/dynamic/private', () => ({ env: dynamic_env }));
vi.mock('$lib/server/subs', () => ({
	save_sub: saveMock,
	delete_sub: deleteMock,
	list_subs: listMock
}));

import { DELETE, GET, POST } from '../+server';

const sub = {
	endpoint: 'https://push.example.net/push/abc',
	keys: { p256dh: 'PUB', auth: 'AUTH' }
};

function event(body?: unknown, uid: string | null = 'me', ua = 'Chrome/140') {
	return {
		request: new Request('https://x/api/push', {
			method: 'POST',
			headers: { 'user-agent': ua, 'content-type': 'application/json' },
			...(body === undefined ? {} : { body: JSON.stringify(body) })
		}),
		locals: { user: uid ? { id: uid, username: 'me' } : null }
	} as unknown as Parameters<typeof POST>[0];
}

beforeEach(() => {
	vi.clearAllMocks();
	Object.assign(dynamic_env, vapid_env);
	saveMock.mockResolvedValue(undefined);
	deleteMock.mockResolvedValue(undefined);
	listMock.mockResolvedValue([]);
});

describe('GET /api/push — the VAPID public key the client subscribes with', () => {
	it('401s when signed out', async () => {
		await expect(GET(event(undefined, null))).rejects.toMatchObject({ status: 401 });
	});

	it('returns the configured public key', async () => {
		expect(await (await GET(event())).json()).toMatchObject({ key: 'BPublicKey' });
	});

	it('503s when push is not configured, instead of handing out an empty key', async () => {
		dynamic_env.VAPID_PUBLIC = '';
		await expect(GET(event())).rejects.toMatchObject({ status: 503 });
	});

	it('never leaks the private key', async () => {
		expect(JSON.stringify(await (await GET(event())).json())).not.toContain('priv');
	});
});

describe('POST /api/push — subscribe', () => {
	it('401s when signed out — a subscription must belong to someone', async () => {
		await expect(POST(event(sub, null))).rejects.toMatchObject({ status: 401 });
		expect(saveMock).not.toHaveBeenCalled();
	});

	it('stores the subscription against the signed-in user', async () => {
		await POST(event(sub));
		expect(saveMock).toHaveBeenCalledWith(expect.anything(), 'me', sub, 'Chrome/140');
	});

	it('400s on a body that is not a subscription', async () => {
		await expect(POST(event({ nope: 1 }))).rejects.toMatchObject({ status: 400 });
		expect(saveMock).not.toHaveBeenCalled();
	});

	it('400s on a missing body', async () => {
		await expect(POST(event())).rejects.toMatchObject({ status: 400 });
	});

	it('400s when the keys are incomplete', async () => {
		await expect(
			POST(event({ endpoint: sub.endpoint, keys: { p256dh: 'PUB' } }))
		).rejects.toMatchObject({ status: 400 });
	});

	it('surfaces a rejected subscription as a 400, not a 500', async () => {
		saveMock.mockRejectedValue(new Error('bad_endpoint'));
		await expect(POST(event(sub))).rejects.toMatchObject({ status: 400 });
	});

	it('confirms success so the client can flip its toggle', async () => {
		expect(await (await POST(event(sub))).json()).toMatchObject({ ok: true });
	});
});

describe('DELETE /api/push — unsubscribe', () => {
	it('401s when signed out', async () => {
		await expect(DELETE(event({ endpoint: sub.endpoint }, null))).rejects.toMatchObject({
			status: 401
		});
	});

	it('forgets the endpoint', async () => {
		await DELETE(event({ endpoint: sub.endpoint }));
		expect(deleteMock).toHaveBeenCalledWith(expect.anything(), sub.endpoint);
	});

	it('400s without an endpoint to forget', async () => {
		await expect(DELETE(event({}))).rejects.toMatchObject({ status: 400 });
		expect(deleteMock).not.toHaveBeenCalled();
	});

	it('is idempotent — unsubscribing twice still succeeds', async () => {
		await DELETE(event({ endpoint: sub.endpoint }));
		expect(await (await DELETE(event({ endpoint: sub.endpoint }))).json()).toMatchObject({
			ok: true
		});
	});
});
