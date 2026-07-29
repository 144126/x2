import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	get_secret_key,
	paystack_init,
	paystack_verify,
	verify_webhook_sig,
	type PaystackEnv
} from '../paystack';

const env: PaystackEnv = {
	PAYSTACK_SECRET_KEY_TEST: 'sk_test_abc',
	PAYSTACK_SECRET_KEY_LIVE: 'sk_live_xyz',
	PAYSTACK_TEST: '.'
};

describe('get_secret_key', () => {
	it('picks the test key when PAYSTACK_TEST is set', async () => {
		expect(await get_secret_key(env)).toBe('sk_test_abc');
	});

	it('picks the live key when PAYSTACK_TEST is unset', async () => {
		expect(await get_secret_key({ ...env, PAYSTACK_TEST: '' })).toBe('sk_live_xyz');
	});
});

describe('paystack_init', () => {
	let fetchMock: ReturnType<typeof vi.fn>;
	beforeEach(() => {
		fetchMock = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					status: true,
					data: {
						authorization_url: 'https://checkout.paystack.com/abc',
						access_code: 'ac',
						reference: 'ref1'
					}
				}),
				{ status: 200 }
			)
		);
		vi.stubGlobal('fetch', fetchMock);
	});
	afterEach(() => vi.unstubAllGlobals());

	it('POSTs to /transaction/initialize with amount in kobo and returns the checkout url', async () => {
		const r = await paystack_init(env, 'a@b.com', 10000, 'ref1', 'https://x/callback');
		expect(r).toEqual({
			authorization_url: 'https://checkout.paystack.com/abc',
			access_code: 'ac',
			reference: 'ref1'
		});
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe('https://api.paystack.co/transaction/initialize');
		expect(init.headers.Authorization).toBe('Bearer sk_test_abc');
		const body = JSON.parse(init.body);
		expect(body).toMatchObject({
			email: 'a@b.com',
			amount: 10000,
			reference: 'ref1',
			callback_url: 'https://x/callback'
		});
	});

	it('rejects on a non-ok paystack response', async () => {
		fetchMock.mockResolvedValue(
			new Response(JSON.stringify({ status: false, message: 'bad' }), { status: 400 })
		);
		await expect(
			paystack_init(env, 'a@b.com', 10000, 'ref1', 'https://x/callback')
		).rejects.toThrow();
	});
});

describe('paystack_verify', () => {
	it('GETs /transaction/verify/:reference', async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					status: true,
					data: {
						status: 'success',
						reference: 'ref1',
						amount: 10000,
						customer: { email: 'a@b.com' },
						metadata: {}
					}
				})
			)
		);
		vi.stubGlobal('fetch', fetchMock);
		const r = await paystack_verify(env, 'ref1');
		expect(r).toMatchObject({ status: 'success', reference: 'ref1', amount: 10000 });
		expect(fetchMock.mock.calls[0][0]).toBe('https://api.paystack.co/transaction/verify/ref1');
		vi.unstubAllGlobals();
	});
});

describe('verify_webhook_sig', () => {
	it('accepts a signature that is HMAC-SHA512 of the raw body under the secret key', async () => {
		const { createHmac } = await import('node:crypto');
		const raw = '{"event":"charge.success"}';
		const sig = createHmac('sha512', 'sk_test_abc').update(raw).digest('hex');
		expect(await verify_webhook_sig(env, raw, sig)).toBe(true);
	});

	it('rejects a wrong signature', async () => {
		expect(await verify_webhook_sig(env, '{}', 'deadbeef')).toBe(false);
	});
});
