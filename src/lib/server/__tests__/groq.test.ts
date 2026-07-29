import { describe, it, expect, vi, beforeEach } from 'vitest';

const { deductMock, creditMock } = vi.hoisted(() => ({
	deductMock: vi.fn(),
	creditMock: vi.fn()
}));

vi.mock('../credit_client', () => ({ deduct: deductMock, credit: creditMock }));

import { whats_in_common } from '../groq';
import type { User } from '../../types';

const ws = {} as never;
const env = { GROQ: 'test-key' } as never;

const a: User = { s: 'u', g: 'a', d: 1, u: 'ada', a: 'loves synths', i: ['music', 'hiking'], ag: 30, co: 'NG' };
const b: User = { s: 'u', g: 'b', d: 1, u: 'bob', a: 'also loves synths', i: ['music', 'coding'], ag: 32, co: 'NG' };

beforeEach(() => {
	vi.clearAllMocks();
	vi.stubGlobal('fetch', vi.fn());
	deductMock.mockResolvedValue({ ok: true, balance: 5000 });
	creditMock.mockResolvedValue({ balance: 5100 });
});

describe('whats_in_common', () => {
	it('short-circuits on insufficient credits without calling Groq', async () => {
		deductMock.mockResolvedValue({ ok: false, reason: 'insufficient_credits', balance: 0 });
		const r = await whats_in_common(env, ws, 'viewer', a, b);
		expect(r).toEqual({ ok: false, reason: 'insufficient_credits' });
		expect(fetch).not.toHaveBeenCalled();
	});

	it('deducts the viewer, not the profile owner', async () => {
		vi.mocked(fetch).mockResolvedValue(
			new Response(
				JSON.stringify({
					choices: [{ message: { content: 'you both love synths and music' } }],
					usage: { prompt_tokens: 100, completion_tokens: 20 }
				})
			)
		);
		await whats_in_common(env, ws, 'viewer-uid', a, b);
		expect(deductMock).toHaveBeenCalledWith(ws, 'viewer-uid', expect.any(Number));
	});

	it('never sends email/password/whatsapp fields to Groq', async () => {
		const withSecrets: User = { ...a, m: 'ada@example.com', h: 'hash', w: '5551234' };
		vi.mocked(fetch).mockResolvedValue(
			new Response(
				JSON.stringify({ choices: [{ message: { content: 'text' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } })
			)
		);
		await whats_in_common(env, ws, 'viewer', withSecrets, b);
		const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
		const prompt = JSON.stringify(body);
		expect(prompt).not.toContain('ada@example.com');
		expect(prompt).not.toContain('hash');
		expect(prompt).not.toContain('5551234');
	});

	it('returns the generated text and cost on success', async () => {
		vi.mocked(fetch).mockResolvedValue(
			new Response(
				JSON.stringify({
					choices: [{ message: { content: 'you both love synths and music' } }],
					usage: { prompt_tokens: 100, completion_tokens: 20 }
				})
			)
		);
		const r = await whats_in_common(env, ws, 'viewer', a, b);
		expect(r).toMatchObject({ ok: true, text: 'you both love synths and music' });
		if (r.ok) expect(r.cost_kobo).toBeGreaterThan(0);
	});

	it('refunds the viewer if Groq fails after a successful deduct', async () => {
		vi.mocked(fetch).mockResolvedValue(new Response('server error', { status: 500 }));
		const r = await whats_in_common(env, ws, 'viewer', a, b);
		expect(r).toEqual({ ok: false, reason: 'llm_error' });
		const deducted = deductMock.mock.calls[0][2];
		expect(creditMock).toHaveBeenCalledWith(ws, 'viewer', deducted);
	});
});
