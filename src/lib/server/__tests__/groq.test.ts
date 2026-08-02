import { describe, it, expect, vi, beforeEach } from 'vitest';

const { deductMock, creditMock, modalCompleteMock } = vi.hoisted(() => ({
	deductMock: vi.fn(),
	creditMock: vi.fn(),
	modalCompleteMock: vi.fn()
}));

vi.mock('../credit_client', () => ({ deduct: deductMock, credit: creditMock }));
vi.mock('../modal', () => ({ modal_complete: modalCompleteMock }));

import { whats_in_common } from '../groq';
import type { User } from '../../types';

const ws = {} as never;
const env = {} as never;

const a: User = {
	s: 'u',
	g: 'a',
	d: 1,
	u: 'ada',
	a: 'loves synths',
	i: ['music', 'hiking'],
	ag: 30,
	co: 'NG'
};
const b: User = {
	s: 'u',
	g: 'b',
	d: 1,
	u: 'bob',
	a: 'also loves synths',
	i: ['music', 'coding'],
	ag: 32,
	co: 'NG'
};

beforeEach(() => {
	vi.clearAllMocks();
	deductMock.mockResolvedValue({ ok: true, balance: 5000 });
	creditMock.mockResolvedValue({ balance: 5100 });
});

describe('whats_in_common', () => {
	it('short-circuits on insufficient credits without calling modal', async () => {
		deductMock.mockResolvedValue({ ok: false, reason: 'insufficient_credits', balance: 0 });
		const r = await whats_in_common(env, ws, 'viewer', a, b);
		expect(r).toEqual({ ok: false, reason: 'insufficient_credits' });
		expect(modalCompleteMock).not.toHaveBeenCalled();
	});

	it('deducts the viewer, not the profile owner', async () => {
		modalCompleteMock.mockResolvedValue('you both love synths and music');
		await whats_in_common(env, ws, 'viewer-uid', a, b);
		expect(deductMock).toHaveBeenCalledWith(ws, 'viewer-uid', expect.any(Number));
	});

	it('never sends email/password/whatsapp fields to modal', async () => {
		const withSecrets: User = { ...a, m: 'ada@example.com', h: 'hash', w: '5551234' };
		modalCompleteMock.mockResolvedValue('text');
		await whats_in_common(env, ws, 'viewer', withSecrets, b);
		const content = modalCompleteMock.mock.calls[0][1][0].content as string;
		expect(content).not.toContain('ada@example.com');
		expect(content).not.toContain('hash');
		expect(content).not.toContain('5551234');
	});

	it('returns the generated text on success', async () => {
		modalCompleteMock.mockResolvedValue('you both love synths and music');
		const r = await whats_in_common(env, ws, 'viewer', a, b);
		expect(r).toEqual({ ok: true, text: 'you both love synths and music' });
	});

	it('refunds the viewer if modal fails after a successful deduct', async () => {
		modalCompleteMock.mockRejectedValue(new Error('modal_error'));
		const r = await whats_in_common(env, ws, 'viewer', a, b);
		expect(r).toEqual({ ok: false, reason: 'llm_error' });
		expect(creditMock).toHaveBeenCalledWith(ws, 'viewer', deductMock.mock.calls[0][2]);
	});
});
