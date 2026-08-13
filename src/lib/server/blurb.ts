import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText } from 'ai';
import {
	ensure,
	get_secret,
	retrieve_one,
	upsert,
	uuid_from,
	type QEnv,
	type SecretVal
} from './qdrant';
import type { User } from '../types';

export const BLURB_MODEL = 'openai/gpt-oss-120b';
const GROQ_URL = 'https://api.groq.com/openai/v1';

/** a blurb only has to be short enough to read while the call connects */
const MAX_WORDS = 14;

type BlurbEnv = QEnv & { GROQ?: SecretVal };

function profile(u: User): string {
	return [u.a, u.i?.join(', '), u.ag, u.ci, u.st, u.co].filter(Boolean).join(' | ');
}

/** the cache key is the conversation id, so the same pair costs one generation ever */
const point_id = (conv: string) => uuid_from(`mb:${conv}`);

async function cached(env: BlurbEnv, conv: string): Promise<string | null> {
	const pt = await retrieve_one(env, await point_id(conv));
	const p = pt?.payload as { s?: string; t?: string } | undefined;
	return p?.s === 'mb' ? (p.t ?? '') : null;
}

async function remember(env: BlurbEnv, conv: string, t: string): Promise<void> {
	await upsert(env, [
		{ id: await point_id(conv), vector: {}, payload: { s: 'mb', t, d: Date.now() } }
	]);
}

/**
 * One line on why these two were paired, written by a model rather than by set
 * intersection — embeddings match on meaning, so the pair that matched best often
 * shares no literal interest token at all.
 *
 * Never throws and never blocks a call: an empty string means "show the plain
 * overlap instead", which is what the caller already has.
 */
export async function match_blurb(env: BlurbEnv, conv: string, a: User, b: User): Promise<string> {
	const pa = profile(a);
	const pb = profile(b);
	// two blank profiles have nothing to compare — never spend a request on them
	if (!pa || !pb) return '';

	await ensure(env);
	const hit = await cached(env, conv).catch(() => null);
	if (hit !== null) return hit;

	const key = await get_secret(env.GROQ);
	if (!key) return '';

	try {
		const groq = createOpenAICompatible({ name: 'groq', baseURL: GROQ_URL, apiKey: key });
		const { text } = await generateText({
			model: groq(BLURB_MODEL),
			temperature: 0.4,
			maxOutputTokens: 60,
			system: `You introduce two strangers who are about to talk. Reply with ONE line of at most ${MAX_WORDS} words, lowercase, no greeting, no quotes, no emoji. Name the real thing they share, in plain words. If they share nothing obvious, name the one thing that would make their conversation interesting anyway. Never invent a fact that is not in the profiles.`,
			prompt: `person a: ${pa}\nperson b: ${pb}`
		});
		// split before unquoting: a model that answers with a quoted line and then keeps
		// talking leaves the closing quote at the end of the first line, not the string
		const line = text
			.trim()
			.split('\n')[0]
			.trim()
			.replace(/^["']|["']$/g, '')
			.slice(0, 120);
		if (line) await remember(env, conv, line).catch(() => {});
		return line;
	} catch {
		// rate limited, slow, or down — the call is already connecting, so say nothing
		return '';
	}
}
