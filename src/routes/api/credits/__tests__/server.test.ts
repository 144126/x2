import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getBalanceMock, creditHistoryMock } = vi.hoisted(() => ({
	getBalanceMock: vi.fn(),
	creditHistoryMock: vi.fn()
}));

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$lib/server/credit_client', () => ({ get_balance: getBalanceMock }));
vi.mock('$lib/server/credits', () => ({ credit_history: creditHistoryMock }));

import { GET } from '../+server';

function event(uid: string | null = 'ada') {
	return {
		locals: { user: uid ? { id: uid, username: 'ada' } : null, x2_ws: {} }
	} as unknown as Parameters<typeof GET>[0];
}

beforeEach(() => {
	vi.clearAllMocks();
	getBalanceMock.mockResolvedValue({ balance: 5400, granted_today: true });
	creditHistoryMock.mockResolvedValue([
		{ s: 'ce', id: '1', uid: 'ada', kind: 'daily_grant', amount: 5400, balance_after: 5400, ts: 1 }
	]);
});

describe('GET /api/credits', () => {
	it('401s when signed out', async () => {
		await expect(GET(event(null))).rejects.toMatchObject({ status: 401 });
	});

	it('returns the balance, grant flag, and recent history', async () => {
		const body = await (await GET(event())).json();
		expect(body).toMatchObject({ balance: 5400, granted_today: true });
		expect(body.history).toHaveLength(1);
		expect(getBalanceMock).toHaveBeenCalledWith({}, 'ada');
		expect(creditHistoryMock).toHaveBeenCalledWith(expect.anything(), 'ada', expect.any(Number));
	});
});
