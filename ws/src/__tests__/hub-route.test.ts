import { describe, it, expect, vi, beforeEach } from 'vitest';
import worker from '../index';

const SECRET = 'shared-secret';

function env(stubFetch: ReturnType<typeof vi.fn>) {
	return {
		SECRET,
		CHAT_HUB: { idFromName: (n: string) => n, get: () => ({ fetch: stubFetch }) },
		CREDIT_ACCOUNT: { idFromName: (n: string) => n, get: () => ({ fetch: vi.fn() }) }
	} as never;
}

function req(path: string, init?: RequestInit) {
	return new Request(`https://dummy${path}`, init);
}

let stubFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
	stubFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true })));
});

describe('/hub/:uid/:action proxy', () => {
	it('denies a request with no bearer token', async () => {
		const res = await worker.fetch!(req('/hub/me/unread'), env(stubFetch), {} as never);
		expect((res as Response).status).toBe(403);
		expect(stubFetch).not.toHaveBeenCalled();
	});

	it('denies a request with the wrong bearer token', async () => {
		const res = await worker.fetch!(
			req('/hub/me/unread', { headers: { authorization: 'Bearer nope' } }),
			env(stubFetch),
			{} as never
		);
		expect((res as Response).status).toBe(403);
	});

	it('routes GET /hub/:uid/unread to that uid’s ChatHub /unread', async () => {
		const res = await worker.fetch!(
			req('/hub/me/unread', { headers: { authorization: `Bearer ${SECRET}` } }),
			env(stubFetch),
			{} as never
		);
		expect((res as Response).status).toBe(200);
		const [request] = stubFetch.mock.calls[0];
		expect((request as Request).url).toBe('https://dummy/unread');
	});

	it('forwards a POST body to the target action', async () => {
		await worker.fetch!(
			req('/hub/me/mute', {
				method: 'POST',
				headers: { authorization: `Bearer ${SECRET}` },
				body: JSON.stringify({ target: 'bob', kind: 'u', until: 0 })
			}),
			env(stubFetch),
			{} as never
		);
		const [request] = stubFetch.mock.calls[0];
		expect(await (request as Request).text()).toBe(
			JSON.stringify({ target: 'bob', kind: 'u', until: 0 })
		);
	});

	it('rejects an action not in the allow-list', async () => {
		const res = await worker.fetch!(
			req('/hub/me/nope', { headers: { authorization: `Bearer ${SECRET}` } }),
			env(stubFetch),
			{} as never
		);
		expect((res as Response).status).toBe(200); // falls through to the catch-all 200 body
		expect(stubFetch).not.toHaveBeenCalled();
	});
});
