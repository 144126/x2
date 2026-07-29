// Server-only. All amounts are in kobo (integer, ×100 of naira).
import { get_secret, type SecretVal } from './qdrant';

export type PaystackEnv = {
	PAYSTACK_SECRET_KEY_TEST?: SecretVal;
	PAYSTACK_SECRET_KEY_LIVE?: SecretVal;
	PAYSTACK_TEST?: SecretVal; // truthy ('.') => use the test key
	PAYSTACK_BASE_URL?: SecretVal;
};

export interface PaystackInitResult {
	authorization_url: string;
	access_code: string;
	reference: string;
}
export interface PaystackVerifyResult {
	status: string;
	reference: string;
	amount: number;
	customer: { email: string };
	metadata: Record<string, unknown>;
}

async function base_url(env: PaystackEnv): Promise<string> {
	return (await get_secret(env.PAYSTACK_BASE_URL)) || 'https://api.paystack.co';
}

export async function get_secret_key(env: PaystackEnv): Promise<string> {
	const test_flag = await get_secret(env.PAYSTACK_TEST);
	return test_flag
		? await get_secret(env.PAYSTACK_SECRET_KEY_TEST)
		: await get_secret(env.PAYSTACK_SECRET_KEY_LIVE);
}

export async function paystack_init(
	env: PaystackEnv,
	email: string,
	amount_kobo: number,
	reference: string,
	callback_url: string,
	metadata?: Record<string, unknown>
): Promise<PaystackInitResult> {
	const key = await get_secret_key(env);
	const res = await fetch(`${await base_url(env)}/transaction/initialize`, {
		method: 'POST',
		headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({ email, amount: amount_kobo, reference, callback_url, metadata })
	});
	const json = (await res.json()) as { status: boolean; message?: string; data?: PaystackInitResult };
	if (!res.ok || !json.status || !json.data) throw new Error(json.message ?? 'paystack init failed');
	return json.data;
}

export async function paystack_verify(env: PaystackEnv, reference: string): Promise<PaystackVerifyResult> {
	const key = await get_secret_key(env);
	const res = await fetch(`${await base_url(env)}/transaction/verify/${encodeURIComponent(reference)}`, {
		headers: { Authorization: `Bearer ${key}` }
	});
	const json = (await res.json()) as { status: boolean; message?: string; data?: PaystackVerifyResult };
	if (!res.ok || !json.status || !json.data) throw new Error(json.message ?? 'paystack verify failed');
	return json.data;
}

export async function verify_webhook_sig(env: PaystackEnv, raw_body: string, signature: string): Promise<boolean> {
	const key = await get_secret_key(env);
	if (!key || !signature) return false;
	const enc = new TextEncoder();
	const crypto_key = await crypto.subtle.importKey(
		'raw',
		enc.encode(key),
		{ name: 'HMAC', hash: 'SHA-512' },
		false,
		['sign']
	);
	const sig = new Uint8Array(await crypto.subtle.sign('HMAC', crypto_key, enc.encode(raw_body)));
	const hex = [...sig].map((b) => b.toString(16).padStart(2, '0')).join('');
	return hex === signature;
}
