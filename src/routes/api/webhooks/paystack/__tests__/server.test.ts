import { describe, it, expect, vi, beforeEach } from 'vitest';

const { verifySigMock, markRefMock, creditMock, recordEventMock, payReferralMock } = vi.hoisted(
	() => ({
		verifySigMock: vi.fn(),
		markRefMock: vi.fn(),
		creditMock: vi.fn(),
		recordEventMock: vi.fn(),
		payReferralMock: vi.fn()
	})
);

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$lib/server/paystack', () => ({ verify_webhook_sig: verifySigMock }));
vi.mock('$lib/server/credits', () => ({
	mark_paystack_ref_processed: markRefMock,
	record_event: recordEventMock
}));
vi.mock('$lib/server/credit_client', () => ({ credit: creditMock }));
vi.mock('$lib/server/partner', () => ({ pay_referral_bonus: payReferralMock }));

import { POST } from '../+server';

function event(body: unknown, sig: string | null = 'sig123') {
	return {
		request: new Request('https://x/api/webhooks/paystack', {
			method: 'POST',
			headers: sig ? { 'x-paystack-signature': sig } : {},
			body: JSON.stringify(body)
		}),
		locals: { x2_ws: {} },
		platform: { context: { waitUntil: (p: Promise<unknown>) => p } }
	} as unknown as Parameters<typeof POST>[0];
}

const charge_success = (over: Record<string, unknown> = {}) => ({
	event: 'charge.success',
	data: {
		reference: 'ref1',
		amount: 10000,
		customer: { email: 'a@b.com' },
		metadata: { uid: 'ada' },
		...over
	}
});

beforeEach(() => {
	vi.clearAllMocks();
	verifySigMock.mockResolvedValue(true);
	markRefMock.mockResolvedValue(true);
	creditMock.mockResolvedValue({ balance: 15400 });
	recordEventMock.mockResolvedValue(undefined);
	payReferralMock.mockResolvedValue(undefined);
});

describe('POST /api/webhooks/paystack', () => {
	it('401s when the signature header is missing', async () => {
		await expect(POST(event(charge_success(), null))).rejects.toMatchObject({ status: 401 });
		expect(creditMock).not.toHaveBeenCalled();
	});

	it('401s when the signature is invalid', async () => {
		verifySigMock.mockResolvedValue(false);
		await expect(POST(event(charge_success()))).rejects.toMatchObject({ status: 401 });
	});

	it('credits the buyer once on a first-time charge.success', async () => {
		const res = await POST(event(charge_success()));
		expect(await res.json()).toEqual({ received: true });
		expect(creditMock).toHaveBeenCalledWith({}, 'ada', 10000);
		expect(recordEventMock).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ uid: 'ada', kind: 'purchase', amount: 10000, ref: 'ref1' })
		);
	});

	it('does not double-credit a replayed webhook for the same reference', async () => {
		markRefMock.mockResolvedValue(false);
		await POST(event(charge_success()));
		expect(creditMock).not.toHaveBeenCalled();
		expect(recordEventMock).not.toHaveBeenCalled();
	});

	it('pays a referral bonus to whoever invited the buyer', async () => {
		await POST(event(charge_success()));
		expect(payReferralMock).toHaveBeenCalledWith(expect.anything(), 10000, 'ada', 'ref1');
	});

	it('ignores events other than charge.success, still responding 200', async () => {
		const res = await POST(event({ event: 'transfer.success', data: {} }));
		expect(res.status).toBe(200);
		expect(creditMock).not.toHaveBeenCalled();
	});

	it('does not credit when the charge carries no attributable uid', async () => {
		await POST(event(charge_success({ metadata: {} })));
		expect(creditMock).not.toHaveBeenCalled();
	});

	it('400s on an unparseable body', async () => {
		const req = {
			request: new Request('https://x/api/webhooks/paystack', {
				method: 'POST',
				headers: { 'x-paystack-signature': 'sig123' },
				body: 'not json'
			}),
			locals: { x2_ws: {} },
			platform: { context: { waitUntil: (p: Promise<unknown>) => p } }
		} as unknown as Parameters<typeof POST>[0];
		await expect(POST(req)).rejects.toMatchObject({ status: 400 });
	});
});
