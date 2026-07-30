import { get_secret, type QEnv, type SecretVal } from './qdrant';
import type { Message } from '../types';

export const MODAL_KOBO_PER_SEC = 278.1;
export const MODAL_START_HOLD_KOBO = 5000;
export const MODAL_MAX_SECONDS = 60;

let endpoint_url: string | null = null;

async function endpoint(env: QEnv & { MODAL_ENDPOINT_URL?: SecretVal }): Promise<string> {
	if (endpoint_url) return endpoint_url;
	const url = await get_secret(env.MODAL_ENDPOINT_URL);
	if (url) {
		endpoint_url = url.replace(/\/$/, '');
		return endpoint_url;
	}
	const workspace = await get_secret(env.MODAL_WORKSPACE);
	const ep_name = await get_secret(env.MODAL_ENDPOINT_NAME);
	const region = (await get_secret(env.MODAL_ROUTING_REGION)) || 'us-west';
	endpoint_url = `https://${workspace}--ep-${ep_name}-server.${region}.modal.direct`;
	return endpoint_url;
}

async function auth_header(env: QEnv & { MODAL_PROXY_TOKEN_ID?: SecretVal; MODAL_PROXY_TOKEN_SECRET?: SecretVal }): Promise<string> {
	const id = await get_secret(env.MODAL_PROXY_TOKEN_ID);
	const secret = await get_secret(env.MODAL_PROXY_TOKEN_SECRET);
	return `Bearer ${id}.${secret}`;
}

export function modal_cost_kobo(seconds: number): number {
	return Math.round(seconds * MODAL_KOBO_PER_SEC);
}

export function serialize_thread(messages: Message[], my_uid: string): { role: 'user' | 'assistant'; content: string }[] {
	return messages.map((m) => ({
		role: m.f === my_uid ? 'user' : 'assistant',
		content: m.x || '(attachment)'
	}));
}

export async function modal_stream(
	env: QEnv & { MODAL_ENDPOINT_URL?: SecretVal; MODAL_WORKSPACE?: SecretVal; MODAL_ENDPOINT_NAME?: SecretVal; MODAL_ROUTING_REGION?: SecretVal; MODAL_PROXY_TOKEN_ID?: SecretVal; MODAL_PROXY_TOKEN_SECRET?: SecretVal },
	messages: { role: string; content: string }[]
): Promise<Response> {
	const url = await endpoint(env);
	const auth = await auth_header(env);
	return fetch(`${url}/v1/chat/completions`, {
		method: 'POST',
		headers: {
			'Authorization': auth,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			model: 'default',
			messages,
			stream: true
		})
	});
}
