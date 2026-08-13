import { describe, it, expect, vi, beforeEach } from 'vitest';
import { get_balance, deduct, credit } from '../credit_client';

function fetcher(responses: Record<string, unknown>) {
	const calls: { url: string; init?: RequestInit }[] = [];
	return {
		calls,
		fetch: vi.fn(async (url: string, init?: RequestInit) => {
			calls.push({ url, init });
			const path = new URL(url).pathname;
			const body = responses[path];
			return new Response(JSON.stringify(body), { status: 200 });
		})
	} as unknown as Fetcher & { calls: typeof calls };
}

describe('get_balance', () => {
	it('calls the uid-scoped balance endpoint', async () => {
		const ws = fetcher({ '/credits/ada/balance': { balance: 5400, granted_today: true } });
		const r = await get_balance(ws, 'ada');
		expect(r).toEqual({ balance: 5400, granted_today: true });
		expect(ws.calls[0].url).toBe('https://x2-ws/credits/ada/balance');
	});

	it('returns a fallback instead of throwing when the response body is not JSON', async () => {
		const ws = {
			fetch: vi.fn().mockResolvedValue(new Response('Worker x2-ws error'))
		} as unknown as Fetcher;
		const r = await get_balance(ws, 'ada');
		expect(r).toEqual({ balance: 0, granted_today: false });
	});

	it('returns a fallback instead of throwing when fetch itself rejects', async () => {
		const ws = {
			fetch: vi.fn().mockRejectedValue(new Error('connection refused'))
		} as unknown as Fetcher;
		const r = await get_balance(ws, 'ada');
		expect(r).toEqual({ balance: 0, granted_today: false });
	});
});

describe('deduct', () => {
	it('posts the amount and returns the result', async () => {
		const ws = fetcher({ '/credits/ada/deduct': { ok: true, balance: 5300 } });
		const r = await deduct(ws, 'ada', 100);
		expect(r).toEqual({ ok: true, balance: 5300 });
		expect(JSON.parse(ws.calls[0].init!.body as string)).toEqual({ amount: 100 });
	});

	it('surfaces an insufficient_credits result', async () => {
		const ws = fetcher({
			'/credits/ada/deduct': { ok: false, reason: 'insufficient_credits', balance: 0 }
		});
		const r = await deduct(ws, 'ada', 999999);
		expect(r).toEqual({ ok: false, reason: 'insufficient_credits', balance: 0 });
	});

	it('returns a fallback instead of throwing on bad response', async () => {
		const ws = { fetch: vi.fn().mockResolvedValue(new Response('not json')) } as unknown as Fetcher;
		const r = await deduct(ws, 'ada', 100);
		expect(r).toEqual({ ok: false, reason: 'service_unavailable', balance: 0 });
	});

	it('returns a fallback when fetch rejects', async () => {
		const ws = { fetch: vi.fn().mockRejectedValue(new Error('timeout')) } as unknown as Fetcher;
		const r = await deduct(ws, 'ada', 100);
		expect(r).toEqual({ ok: false, reason: 'service_unavailable', balance: 0 });
	});
});

describe('credit', () => {
	it('posts the amount and returns the new balance', async () => {
		const ws = fetcher({ '/credits/ada/credit': { balance: 15400 } });
		const r = await credit(ws, 'ada', 10000);
		expect(r).toEqual({ balance: 15400 });
	});

	it('returns a fallback instead of throwing on bad response', async () => {
		const ws = { fetch: vi.fn().mockResolvedValue(new Response('not json')) } as unknown as Fetcher;
		const r = await credit(ws, 'ada', 10000);
		expect(r).toEqual({ balance: 0 });
	});

	it('returns a fallback when fetch rejects', async () => {
		const ws = { fetch: vi.fn().mockRejectedValue(new Error('timeout')) } as unknown as Fetcher;
		const r = await credit(ws, 'ada', 10000);
		expect(r).toEqual({ balance: 0 });
	});
});
