import { describe, it, expect, vi, beforeEach } from 'vitest';

const { deductMock, creditMock, generateTextMock } = vi.hoisted(() => ({
	deductMock: vi.fn(),
	creditMock: vi.fn(),
	generateTextMock: vi.fn()
}));

vi.mock('../credit_client', () => ({ deduct: deductMock, credit: creditMock }));
vi.mock('ai', () => ({ generateText: generateTextMock }));
vi.mock('@ai-sdk/openai-compatible', () => ({
	createOpenAICompatible: () => (id: string) => ({ id })
}));

import { whats_in_common } from '../groq';
import type { User } from '../../types';

const ws = {} as never;
const env = { GROQ: 'gk' } as never;

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

const prompt = () => generateTextMock.mock.calls[0][0].prompt as string;

beforeEach(() => {
	vi.clearAllMocks();
	deductMock.mockResolvedValue({ ok: true, balance: 5000 });
	creditMock.mockResolvedValue({ balance: 5100 });
	generateTextMock.mockResolvedValue({ text: 'you both love synths and music' });
});

describe('whats_in_common', () => {
	it('short-circuits on insufficient credits without asking the model', async () => {
		deductMock.mockResolvedValue({ ok: false, reason: 'insufficient_credits', balance: 0 });
		const r = await whats_in_common(env, ws, 'viewer', a, b);
		expect(r).toEqual({ ok: false, reason: 'insufficient_credits' });
		expect(generateTextMock).not.toHaveBeenCalled();
	});

	it('deducts the viewer, not the profile owner', async () => {
		await whats_in_common(env, ws, 'viewer-uid', a, b);
		expect(deductMock).toHaveBeenCalledWith(ws, 'viewer-uid', expect.any(Number));
	});

	it('never sends email/password/whatsapp fields to the model', async () => {
		const withSecrets: User = { ...a, m: 'ada@example.com', h: 'hash', w: '5551234' };
		await whats_in_common(env, ws, 'viewer', withSecrets, b);
		expect(prompt()).not.toContain('ada@example.com');
		expect(prompt()).not.toContain('hash');
		expect(prompt()).not.toContain('5551234');
	});

	it('returns the generated text on success', async () => {
		const r = await whats_in_common(env, ws, 'viewer', a, b);
		expect(r).toEqual({ ok: true, text: 'you both love synths and music' });
	});

	it('keeps only the first line, unquoted', async () => {
		generateTextMock.mockResolvedValue({ text: '"you both love synths"\n\nlet me know!' });
		const r = await whats_in_common(env, ws, 'viewer', a, b);
		expect(r).toEqual({ ok: true, text: 'you both love synths' });
	});

	it('refunds the viewer when the model fails after a successful deduct', async () => {
		generateTextMock.mockRejectedValue(new Error('groq_error'));
		const r = await whats_in_common(env, ws, 'viewer', a, b);
		expect(r).toEqual({ ok: false, reason: 'llm_error' });
		expect(creditMock).toHaveBeenCalledWith(ws, 'viewer', deductMock.mock.calls[0][2]);
	});

	it('refunds the viewer when the model answers with nothing', async () => {
		generateTextMock.mockResolvedValue({ text: '   ' });
		const r = await whats_in_common(env, ws, 'viewer', a, b);
		expect(r).toEqual({ ok: false, reason: 'llm_error' });
		expect(creditMock).toHaveBeenCalledWith(ws, 'viewer', deductMock.mock.calls[0][2]);
	});

	it('charges nothing when either card is empty', async () => {
		const blank: User = { s: 'u', g: 'c', d: 1, u: 'cy' };
		const r = await whats_in_common(env, ws, 'viewer', a, blank);
		expect(r).toEqual({ ok: false, reason: 'blank_profiles' });
		expect(deductMock).not.toHaveBeenCalled();
		expect(generateTextMock).not.toHaveBeenCalled();
	});

	it('charges nothing when the groq key is missing', async () => {
		const r = await whats_in_common({} as never, ws, 'viewer', a, b);
		expect(r).toEqual({ ok: false, reason: 'llm_error' });
		expect(deductMock).not.toHaveBeenCalled();
	});
});
