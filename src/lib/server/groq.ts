import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText } from 'ai';
import { deduct, credit } from './credit_client';
import { get_secret, type QEnv, type SecretVal } from './qdrant';
import type { User } from '../types';

export const COMMON_MODEL = 'openai/gpt-oss-120b';
const GROQ_URL = 'https://api.groq.com/openai/v1';

const ESTIMATE_KOBO = 500; // flat, small — one short sentence, no per-token pricing available for this provider

type CommonEnv = QEnv & { GROQ?: SecretVal };

function profile_summary(u: User): string {
	return [u.a, u.i?.join(', '), u.ag, u.co, u.st, u.ci].filter(Boolean).join(' | ');
}

export type CommonReason = 'insufficient_credits' | 'llm_error' | 'blank_profiles';

export async function whats_in_common(
	env: CommonEnv,
	ws: Fetcher,
	viewer_uid: string,
	a: User,
	b: User
): Promise<{ ok: true; text: string } | { ok: false; reason: CommonReason }> {
	const pa = profile_summary(a);
	const pb = profile_summary(b);
	// two blank cards have nothing to compare — say so instead of charging for a guess
	if (!pa || !pb) return { ok: false, reason: 'blank_profiles' };

	const key = await get_secret(env.GROQ);
	if (!key) return { ok: false, reason: 'llm_error' };

	const gate = await deduct(ws, viewer_uid, ESTIMATE_KOBO);
	if (!gate.ok)
		return {
			ok: false,
			reason: gate.reason === 'service_unavailable' ? 'llm_error' : 'insufficient_credits'
		};

	try {
		const groq = createOpenAICompatible({ name: 'groq', baseURL: GROQ_URL, apiKey: key });
		const { text } = await generateText({
			model: groq(COMMON_MODEL),
			temperature: 0.4,
			// gpt-oss reasons before it answers and bills the thinking against the same budget:
			// a small cap spends every token thinking and returns an empty string. Low effort
			// plus room is what reliably produces a line.
			maxOutputTokens: 400,
			providerOptions: { groq: { reasoning_effort: 'low' } },
			system:
				'You tell one person what they share with another. Reply with ONE sentence, lowercase, no greeting, no quotes, no emoji. Name the real thing they share, in plain words. Never invent a fact that is not in the profiles.',
			prompt: `person a: ${pa}\nperson b: ${pb}`
		});
		const line = text
			.trim()
			.split('\n')[0]
			.trim()
			.replace(/^["']|["']$/g, '')
			.slice(0, 200);
		if (!line) throw new Error('groq_empty');
		return { ok: true, text: line };
	} catch {
		await credit(ws, viewer_uid, ESTIMATE_KOBO);
		return { ok: false, reason: 'llm_error' };
	}
}
