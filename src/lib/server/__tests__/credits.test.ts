import { describe, it, expect, vi, beforeEach } from 'vitest';

const { ensureMock, upsertMock, scrollMock, retrieveOneMock } = vi.hoisted(() => ({
	ensureMock: vi.fn(),
	upsertMock: vi.fn(),
	scrollMock: vi.fn(),
	retrieveOneMock: vi.fn()
}));

vi.mock('../qdrant', async () => {
	const actual = await vi.importActual<typeof import('../qdrant')>('../qdrant');
	return {
		...actual,
		ensure: ensureMock,
		upsert: upsertMock,
		scroll: scrollMock,
		retrieve_one: retrieveOneMock
	};
});

import { uuid_from, type QEnv } from '../qdrant';
import { record_event, credit_history, mark_paystack_ref_processed } from '../credits';

const env = {} as QEnv;

beforeEach(() => {
	vi.clearAllMocks();
	ensureMock.mockResolvedValue(undefined);
	upsertMock.mockResolvedValue(undefined);
	scrollMock.mockResolvedValue([]);
	retrieveOneMock.mockResolvedValue(null);
});

describe('record_event', () => {
	it('writes a ledger point for the uid', async () => {
		await record_event(env, {
			uid: 'ada',
			kind: 'daily_grant',
			amount: 5400,
			balance_after: 5400,
			ts: 1
		});
		const point = upsertMock.mock.calls[0][1][0];
		expect(point.payload).toMatchObject({
			s: 'ce',
			uid: 'ada',
			kind: 'daily_grant',
			amount: 5400,
			balance_after: 5400,
			ts: 1
		});
	});

	it('carries an optional ref (e.g. a paystack reference) for purchase events', async () => {
		await record_event(env, {
			uid: 'ada',
			kind: 'purchase',
			amount: 10000,
			balance_after: 15400,
			ts: 1,
			ref: 'psk_123'
		});
		expect(upsertMock.mock.calls[0][1][0].payload.ref).toBe('psk_123');
	});
});

describe('credit_history', () => {
	it('returns the events for a uid', async () => {
		scrollMock.mockResolvedValue([
			{
				id: 'x',
				payload: {
					s: 'ce',
					uid: 'ada',
					kind: 'daily_grant',
					amount: 5400,
					balance_after: 5400,
					ts: 5
				}
			}
		]);
		const h = await credit_history(env, 'ada');
		expect(h).toEqual([
			{ s: 'ce', uid: 'ada', kind: 'daily_grant', amount: 5400, balance_after: 5400, ts: 5 }
		]);
		const filter = scrollMock.mock.calls[0][1];
		expect(filter.must).toContainEqual({ key: 's', match: { value: 'ce' } });
		expect(filter.must).toContainEqual({ key: 'uid', match: { value: 'ada' } });
	});

	it('is empty for a uid with no history', async () => {
		expect(await credit_history(env, 'ada')).toEqual([]);
	});
});

describe('mark_paystack_ref_processed', () => {
	it('returns true (newly processed) the first time a reference is seen', async () => {
		expect(await mark_paystack_ref_processed(env, 'psk_123')).toBe(true);
		expect(upsertMock).toHaveBeenCalled();
	});

	it('returns false when the reference was already processed — the dedup guard', async () => {
		retrieveOneMock.mockResolvedValue({
			id: await uuid_from('paystack:psk_123'),
			payload: { s: 'pr' }
		});
		expect(await mark_paystack_ref_processed(env, 'psk_123')).toBe(false);
		expect(upsertMock).not.toHaveBeenCalled();
	});
});
