// Per-model USD/1M-token rates. Only the model x2 actually calls (Groq's "what you have in
// common" feature) is priced here — add a row when a new paid model is wired up, not before.
export const GROQ_MODEL = 'llama-3.1-8b-instant';

type Rate = { input: number; output: number }; // USD per 1,000,000 tokens
const RATES: Record<string, Rate> = {
	[GROQ_MODEL]: { input: 0.05, output: 0.08 } // confirmed via web search, July 2026
};

export function calc_cost_usd(model: string, input_tokens: number, output_tokens: number): number {
	const rate = RATES[model];
	if (!rate) return 0;
	return (input_tokens * rate.input + output_tokens * rate.output) / 1_000_000;
}

// naira/USD — matches e4's hardcoded rate; adjust here if it needs to track a live FX rate later
export const NGN_USD = 1440;

export function usd_to_kobo(usd: number, rate: number = NGN_USD): number {
	return Math.round(usd * rate * 100);
}
