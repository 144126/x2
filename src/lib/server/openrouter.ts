import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel } from 'ai';
import { get_secret, type QEnv, type SecretVal } from './qdrant';
import type { Message } from '../types';

export const THREAD_MODEL = 'deepseek/deepseek-v4-flash-0731';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1';

/** held before the stream starts, then settled against real token use once it ends */
export const THREAD_HOLD_KOBO = 500;

export type ThreadEnv = QEnv & { OPENROUTER?: SecretVal };

/** null when the key is not bound — the caller answers with a plain error, never a broken url */
export async function thread_model(env: ThreadEnv): Promise<LanguageModel | null> {
	const key = await get_secret(env.OPENROUTER);
	if (!key) return null;
	return createOpenAICompatible({ name: 'openrouter', baseURL: OPENROUTER_URL, apiKey: key })(
		THREAD_MODEL
	);
}

export function serialize_thread(
	messages: Message[],
	my_uid: string
): { role: 'user' | 'assistant'; content: string }[] {
	return messages.map((m) => ({
		role: m.f === my_uid ? 'user' : 'assistant',
		content: m.x || '(attachment)'
	}));
}
