import { get_secret, type QEnv, type SecretVal } from './qdrant';

let cached: CryptoKey | null = null;

async function aes_key(env: QEnv & { MESSAGE_ENC_KEY?: SecretVal }): Promise<CryptoKey> {
	if (cached) return cached;
	const raw = await get_secret(env.MESSAGE_ENC_KEY);
	if (!raw) throw new Error('MESSAGE_ENC_KEY unset — cannot encrypt message text');
	const bytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
	cached = await crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
	return cached;
}

export function __reset_msg_crypto(): void {
	cached = null;
}

export async function encrypt_text(env: QEnv, text: string): Promise<string> {
	if (!text) return text;
	const key = await aes_key(env);
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const buf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text));
	const combined = new Uint8Array(iv.length + buf.byteLength);
	combined.set(iv, 0);
	combined.set(new Uint8Array(buf), iv.length);
	return 'enc:' + btoa(String.fromCharCode(...combined));
}

// ponytail: legacy plaintext messages (stored before this change) have no 'enc:' prefix and
// are returned as-is — no backfill migration. Run one if full at-rest coverage of pre-existing
// messages is required.
export async function decrypt_text(env: QEnv, stored: string): Promise<string> {
	if (!stored.startsWith('enc:')) return stored;
	try {
		const combined = Uint8Array.from(atob(stored.slice(4)), (c) => c.charCodeAt(0));
		const key = await aes_key(env);
		const buf = await crypto.subtle.decrypt(
			{ name: 'AES-GCM', iv: combined.slice(0, 12) },
			key,
			combined.slice(12)
		);
		return new TextDecoder().decode(buf);
	} catch {
		return stored;
	}
}
