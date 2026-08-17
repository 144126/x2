// Per-model USD/1M-token rates. Only a model x2 actually calls is priced here — add a row
// when a new paid model is wired up, not before.
export const GROQ_MODEL = 'llama-3.1-8b-instant';
export const THREAD_MODEL = 'deepseek/deepseek-v4-flash-0731';

type Rate = { input: number; output: number }; // USD per 1,000,000 tokens
const RATES: Record<string, Rate> = {
	[GROQ_MODEL]: { input: 0.05, output: 0.08 }, // confirmed via web search, July 2026
	[THREAD_MODEL]: { input: 0.14, output: 0.28 } // openrouter /api/v1/models, August 2026
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

/** what a finished thread answer costs the user, in kobo */
export function thread_cost_kobo(input_tokens: number, output_tokens: number): number {
	return usd_to_kobo(calc_cost_usd(THREAD_MODEL, input_tokens, output_tokens));
}
