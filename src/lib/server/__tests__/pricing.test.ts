import { describe, it, expect } from 'vitest';
import { calc_cost_usd, usd_to_kobo, NGN_USD, GROQ_MODEL } from '../pricing';

describe('calc_cost_usd', () => {
	it('prices a known model from its per-million-token rate', () => {
		// Groq llama-3.1-8b-instant: $0.05/M input, $0.08/M output (confirmed via web search)
		const cost = calc_cost_usd(GROQ_MODEL, 1_000_000, 1_000_000);
		expect(cost).toBeCloseTo(0.05 + 0.08, 6);
	});

	it('scales linearly with token count', () => {
		expect(calc_cost_usd(GROQ_MODEL, 500_000, 0)).toBeCloseTo(0.025, 6);
	});

	it('returns 0 for an unrecognized model rather than throwing', () => {
		expect(calc_cost_usd('not-a-real-model', 1000, 1000)).toBe(0);
	});

	it('returns 0 for zero tokens', () => {
		expect(calc_cost_usd(GROQ_MODEL, 0, 0)).toBe(0);
	});
});

describe('usd_to_kobo', () => {
	it('converts at the default NGN/USD rate', () => {
		expect(usd_to_kobo(1)).toBe(Math.round(NGN_USD * 100));
	});

	it('accepts an explicit rate', () => {
		expect(usd_to_kobo(2, 1000)).toBe(200_000);
	});

	it('rounds to the nearest kobo', () => {
		expect(usd_to_kobo(0.001, 1440)).toBe(Math.round(0.001 * 1440 * 100));
	});
});
