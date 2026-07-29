import { describe, it, expect, vi, beforeEach } from 'vitest';

const { retrieveOneMock, creditMock, recordEventMock, getUserMock, patchUserMock, scrollMock } =
	vi.hoisted(() => ({
		retrieveOneMock: vi.fn(),
		creditMock: vi.fn(),
		recordEventMock: vi.fn(),
		getUserMock: vi.fn(),
		patchUserMock: vi.fn(),
		scrollMock: vi.fn()
	}));

vi.mock('../qdrant', async () => {
	const actual = await vi.importActual<typeof import('../qdrant')>('../qdrant');
	return { ...actual, retrieve_one: retrieveOneMock, scroll: scrollMock };
});
vi.mock('../credit_client', () => ({ credit: creditMock }));
vi.mock('../credits', () => ({ record_event: recordEventMock }));
vi.mock('../user', () => ({ get_user: getUserMock, patch_user: patchUserMock }));

import {
	pay_referral_bonus,
	gen_partner_code,
	ensure_partner_code,
	attribute_referral
} from '../partner';

const ctx = { env: {}, ws: {} } as never;
const ENV = { QDRANT_URL: 'u', QDRANT_KEY: 'k' };

beforeEach(() => {
	vi.clearAllMocks();
	creditMock.mockResolvedValue({ balance: 5400 + 5400 });
	recordEventMock.mockResolvedValue(undefined);
	getUserMock.mockResolvedValue(null);
	patchUserMock.mockResolvedValue(null);
	scrollMock.mockResolvedValue([]);
});

describe('pay_referral_bonus', () => {
	it('pays 54% of the purchase to the buyer’s inviter', async () => {
		retrieveOneMock.mockResolvedValue({
			id: 'ada',
			payload: { s: 'u', u: 'ada', d: 1, invited_by: 'bob' }
		});
		await pay_referral_bonus(ctx, 10000, 'ada', 'ref1');
		expect(creditMock).toHaveBeenCalledWith({}, 'bob', 5400);
	});

	it('rounds the commission to the nearest kobo', async () => {
		retrieveOneMock.mockResolvedValue({
			id: 'ada',
			payload: { s: 'u', u: 'ada', d: 1, invited_by: 'bob' }
		});
		await pay_referral_bonus(ctx, 10001, 'ada', 'ref1');
		expect(creditMock).toHaveBeenCalledWith({}, 'bob', Math.round(10001 * 0.54));
	});

	it('records a referral_bonus ledger event for the inviter', async () => {
		retrieveOneMock.mockResolvedValue({
			id: 'ada',
			payload: { s: 'u', u: 'ada', d: 1, invited_by: 'bob' }
		});
		await pay_referral_bonus(ctx, 10000, 'ada', 'ref1');
		expect(recordEventMock).toHaveBeenCalledWith(
			{},
			expect.objectContaining({ uid: 'bob', kind: 'referral_bonus', amount: 5400, ref: 'ref1' })
		);
	});

	it('does nothing when the buyer was not referred by anyone', async () => {
		retrieveOneMock.mockResolvedValue({ id: 'ada', payload: { s: 'u', u: 'ada', d: 1 } });
		await pay_referral_bonus(ctx, 10000, 'ada', 'ref1');
		expect(creditMock).not.toHaveBeenCalled();
	});

	it('does nothing when the buyer does not exist', async () => {
		retrieveOneMock.mockResolvedValue(null);
		await pay_referral_bonus(ctx, 10000, 'ghost', 'ref1');
		expect(creditMock).not.toHaveBeenCalled();
	});

	it('refuses to pay a bonus for a self-referral, defensively', async () => {
		retrieveOneMock.mockResolvedValue({
			id: 'ada',
			payload: { s: 'u', u: 'ada', d: 1, invited_by: 'ada' }
		});
		await pay_referral_bonus(ctx, 10000, 'ada', 'ref1');
		expect(creditMock).not.toHaveBeenCalled();
	});
});

describe('gen_partner_code', () => {
	it('generates a non-empty, url-safe code', () => {
		const code = gen_partner_code();
		expect(code.length).toBeGreaterThanOrEqual(6);
		expect(code).toMatch(/^[a-z0-9]+$/);
	});

	it('generates a different code on each call', () => {
		expect(gen_partner_code()).not.toBe(gen_partner_code());
	});
});

describe('ensure_partner_code', () => {
	it('assigns a fresh code to a user who has none', async () => {
		getUserMock.mockResolvedValue({ s: 'u', u: 'ada', d: 1 });
		patchUserMock.mockImplementation(async (_e, _uid, patch) => ({
			s: 'u',
			u: 'ada',
			d: 1,
			...patch
		}));
		const code = await ensure_partner_code(ENV, 'ada');
		expect(code).toBeTruthy();
		expect(patchUserMock).toHaveBeenCalledWith(ENV, 'ada', { ac: code });
	});

	it('is a no-op for a user who already has a code', async () => {
		getUserMock.mockResolvedValue({ s: 'u', u: 'ada', d: 1, ac: 'EXIST1' });
		const code = await ensure_partner_code(ENV, 'ada');
		expect(code).toBe('EXIST1');
		expect(patchUserMock).not.toHaveBeenCalled();
	});

	it('retries generation on the rare collision with an existing code', async () => {
		getUserMock.mockResolvedValue({ s: 'u', u: 'ada', d: 1 });
		scrollMock
			.mockResolvedValueOnce([{ id: 'x', payload: { s: 'u', ac: 'dup' } }])
			.mockResolvedValueOnce([]);
		patchUserMock.mockImplementation(async (_e, _uid, patch) => ({
			s: 'u',
			u: 'ada',
			d: 1,
			...patch
		}));
		await ensure_partner_code(ENV, 'ada');
		expect(scrollMock).toHaveBeenCalledTimes(2);
	});
});

describe('attribute_referral', () => {
	it('attributes a new user to the partner owning the code', async () => {
		scrollMock.mockResolvedValue([{ id: 'bob', payload: { s: 'u', u: 'bob', d: 1, ac: 'CODE1' } }]);
		const r = await attribute_referral(ENV, 'new-uid', 'CODE1');
		expect(r).toEqual({ ok: true, inviter: 'bob' });
		expect(patchUserMock).toHaveBeenCalledWith(ENV, 'new-uid', { invited_by: 'bob' });
	});

	it('rejects an unknown code', async () => {
		scrollMock.mockResolvedValue([]);
		const r = await attribute_referral(ENV, 'new-uid', 'NOPE');
		expect(r).toEqual({ ok: false });
		expect(patchUserMock).not.toHaveBeenCalled();
	});

	it('rejects attributing a user to themself', async () => {
		scrollMock.mockResolvedValue([
			{ id: 'new-uid', payload: { s: 'u', u: 'x', d: 1, ac: 'CODE1' } }
		]);
		const r = await attribute_referral(ENV, 'new-uid', 'CODE1');
		expect(r).toEqual({ ok: false });
		expect(patchUserMock).not.toHaveBeenCalled();
	});

	it('rejects a blank code', async () => {
		const r = await attribute_referral(ENV, 'new-uid', '');
		expect(r).toEqual({ ok: false });
		expect(scrollMock).not.toHaveBeenCalled();
	});
});
