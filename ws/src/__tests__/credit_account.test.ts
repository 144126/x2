import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CreditAccount, DAILY_GRANT } from '../credit_account';

function makeState() {
	const store = new Map<string, unknown>();
	return {
		storage: {
			get: vi.fn(async (k: string) => store.get(k)),
			put: vi.fn(async (k: string, v: unknown) => {
				store.set(k, v);
			})
		}
	};
}

function req(path: string, init?: RequestInit) {
	return new Request(`https://dummy${path}`, init);
}

describe('CreditAccount', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(1_800_000_000_000);
	});
	afterEach(() => vi.useRealTimers());

	it('grants the daily amount to a brand-new account on first balance read', async () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const acct = new CreditAccount(makeState() as any, {} as any);
		const res = await acct.fetch(req('/balance'));
		expect(await res.json()).toEqual({ balance: DAILY_GRANT, granted_today: true });
	});

	it('does not grant a second time within the same rolling 24h window', async () => {
		const state = makeState();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const acct = new CreditAccount(state as any, {} as any);
		await acct.fetch(req('/balance'));
		vi.setSystemTime(1_800_000_000_000 + 1000);
		const res = await acct.fetch(req('/balance'));
		expect(await res.json()).toEqual({ balance: DAILY_GRANT, granted_today: false });
	});

	it('grants again once 24h have passed since the last grant', async () => {
		const state = makeState();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const acct = new CreditAccount(state as any, {} as any);
		await acct.fetch(req('/balance'));
		vi.setSystemTime(1_800_000_000_000 + 86_400_000);
		const res = await acct.fetch(req('/balance'));
		expect(await res.json()).toEqual({ balance: DAILY_GRANT * 2, granted_today: true });
	});

	it('deducts below the balance and returns the new balance', async () => {
		const state = makeState();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const acct = new CreditAccount(state as any, {} as any);
		const res = await acct.fetch(
			req('/deduct', { method: 'POST', body: JSON.stringify({ amount: 100 }) })
		);
		expect(await res.json()).toEqual({ ok: true, balance: DAILY_GRANT - 100 });
	});

	it('refuses a deduction larger than the balance, unchanged, no clamping', async () => {
		const state = makeState();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const acct = new CreditAccount(state as any, {} as any);
		const res = await acct.fetch(
			req('/deduct', { method: 'POST', body: JSON.stringify({ amount: DAILY_GRANT + 1 }) })
		);
		expect(await res.json()).toEqual({
			ok: false,
			reason: 'insufficient_credits',
			balance: DAILY_GRANT
		});
		const bal = await (await acct.fetch(req('/balance'))).json();
		expect(bal.balance).toBe(DAILY_GRANT);
	});

	it('deduct also performs the lazy daily grant first, like balance does', async () => {
		const state = makeState();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const acct = new CreditAccount(state as any, {} as any);
		const res = await acct.fetch(
			req('/deduct', { method: 'POST', body: JSON.stringify({ amount: 50 }) })
		);
		expect(await res.json()).toEqual({ ok: true, balance: DAILY_GRANT - 50 });
	});

	it('credits an arbitrary amount (purchase / referral bonus)', async () => {
		const state = makeState();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const acct = new CreditAccount(state as any, {} as any);
		await acct.fetch(req('/balance'));
		const res = await acct.fetch(
			req('/credit', { method: 'POST', body: JSON.stringify({ amount: 10000 }) })
		);
		expect(await res.json()).toEqual({ balance: DAILY_GRANT + 10000 });
	});

	it('serializes sequential deduct calls correctly — no lost updates', async () => {
		const state = makeState();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const acct = new CreditAccount(state as any, {} as any);
		await acct.fetch(req('/balance'));
		await acct.fetch(req('/deduct', { method: 'POST', body: JSON.stringify({ amount: 1000 }) }));
		await acct.fetch(req('/deduct', { method: 'POST', body: JSON.stringify({ amount: 1000 }) }));
		const bal = await (await acct.fetch(req('/balance'))).json();
		expect(bal.balance).toBe(DAILY_GRANT - 2000);
	});

	it('400s an unrecognized path', async () => {
		const state = makeState();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const acct = new CreditAccount(state as any, {} as any);
		const res = await acct.fetch(req('/nope'));
		expect(res.status).toBe(400);
	});
});
