import { deduct, credit } from './credit_client';
import { calc_cost_usd, usd_to_kobo, GROQ_MODEL } from './pricing';
import { get_secret, type SecretVal } from './qdrant';
import type { User } from '../types';

export type GroqEnv = { GROQ?: SecretVal };

// flat upfront estimate (a typical prompt + reply for this feature) — deducted before the paid
// call since real usage isn't known yet; refunded in full on failure.
const ESTIMATE_KOBO = usd_to_kobo(calc_cost_usd(GROQ_MODEL, 300, 150));

function profile_summary(u: User): string {
	return [u.a, u.i?.join(', '), u.ag, u.co, u.st, u.ci].filter(Boolean).join(' | ');
}

export async function whats_in_common(
	env: GroqEnv,
	ws: Fetcher,
	viewer_uid: string,
	a: User,
	b: User
): Promise<
	| { ok: true; text: string; cost_kobo: number }
	| { ok: false; reason: 'insufficient_credits' | 'llm_error' }
> {
	const gate = await deduct(ws, viewer_uid, ESTIMATE_KOBO);
	if (!gate.ok) return { ok: false, reason: gate.reason === 'service_unavailable' ? 'llm_error' : 'insufficient_credits' };

	try {
		const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				authorization: `Bearer ${await get_secret(env.GROQ)}`
			},
			body: JSON.stringify({
				model: GROQ_MODEL,
				messages: [
					{
						role: 'user',
						content: `In one short friendly sentence, what do these two people have in common?\nPerson A: ${profile_summary(a)}\nPerson B: ${profile_summary(b)}`
					}
				]
			})
		});
		if (!res.ok) throw new Error('groq_error');
		const data = (await res.json()) as {
			choices: { message: { content: string } }[];
			usage: { prompt_tokens: number; completion_tokens: number };
		};
		const text = data.choices[0]?.message?.content?.trim();
		if (!text) throw new Error('groq_empty');
		const cost_kobo = usd_to_kobo(
			calc_cost_usd(GROQ_MODEL, data.usage.prompt_tokens, data.usage.completion_tokens)
		);
		return { ok: true, text, cost_kobo };
	} catch {
		await credit(ws, viewer_uid, ESTIMATE_KOBO);
		return { ok: false, reason: 'llm_error' };
	}
}
