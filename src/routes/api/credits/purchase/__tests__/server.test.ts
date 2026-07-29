import { describe, it, expect, vi, beforeEach } from 'vitest';

const { paystackInitMock } = vi.hoisted(() => ({ paystackInitMock: vi.fn() }));

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$lib/server/paystack', () => ({ paystack_init: paystackInitMock }));

import { POST } from '../+server';

function event(body?: unknown, uid: string | null = 'ada', email?: string) {
	return {
		request: new Request('https://x/api/credits/purchase', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			...(body === undefined ? {} : { body: JSON.stringify(body) })
		}),
		locals: { user: uid ? { id: uid, username: 'ada', email } : null }
	} as unknown as Parameters<typeof POST>[0];
}

beforeEach(() => {
	vi.clearAllMocks();
	paystackInitMock.mockResolvedValue({
		authorization_url: 'https://checkout.paystack.com/x',
		access_code: 'ac',
		reference: 'ref1'
	});
});

describe('POST /api/credits/purchase', () => {
	it('401s when signed out', async () => {
		await expect(POST(event({ amount_kobo: 10000 }, null))).rejects.toMatchObject({ status: 401 });
	});

	it('400s below the minimum purchase amount', async () => {
		await expect(POST(event({ amount_kobo: 100 }))).rejects.toMatchObject({ status: 400 });
	});

	it('400s on a missing/invalid body', async () => {
		await expect(POST(event())).rejects.toMatchObject({ status: 400 });
	});

	it('initializes a paystack transaction and returns the checkout url', async () => {
		const body = await (await POST(event({ amount_kobo: 10000 }, 'ada', 'ada@x.com'))).json();
		expect(body).toMatchObject({ authorization_url: 'https://checkout.paystack.com/x', reference: expect.any(String) });
		expect(paystackInitMock.mock.calls[0][1]).toBe('ada@x.com');
		expect(paystackInitMock.mock.calls[0][2]).toBe(10000);
	});

	it('falls back to a synthetic email for a user with none on file', async () => {
		await POST(event({ amount_kobo: 10000 }, 'ada', undefined));
		expect(paystackInitMock.mock.calls[0][1]).toBe('ada@x2.studio');
	});

	it('stamps the purchasing uid into paystack metadata, for the webhook to read', async () => {
		await POST(event({ amount_kobo: 10000 }, 'ada', 'ada@x.com'));
		expect(paystackInitMock.mock.calls[0][5]).toMatchObject({ uid: 'ada' });
	});

	it('surfaces a paystack failure as a 502, not a 500 crash', async () => {
		paystackInitMock.mockRejectedValue(new Error('paystack down'));
		await expect(POST(event({ amount_kobo: 10000 }))).rejects.toMatchObject({ status: 502 });
	});
});
