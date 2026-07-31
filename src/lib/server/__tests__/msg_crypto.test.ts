import { describe, it, expect } from 'vitest';
import { encrypt_text, decrypt_text } from '../msg_crypto';

const KEY_B64 = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
const env = { MESSAGE_ENC_KEY: KEY_B64 } as never;

describe('msg_crypto', () => {
	it('round-trips text through encrypt then decrypt', async () => {
		const cipher = await encrypt_text(env, 'hello world');
		expect(cipher.startsWith('enc:')).toBe(true);
		expect(cipher).not.toContain('hello world');
		expect(await decrypt_text(env, cipher)).toBe('hello world');
	});
	it('returns empty string unchanged', async () => {
		expect(await encrypt_text(env, '')).toBe('');
	});
	it('passes through legacy plaintext (no enc: prefix) unchanged', async () => {
		expect(await decrypt_text(env, 'plain old text')).toBe('plain old text');
	});
	it('produces a different ciphertext each call (random iv)', async () => {
		const a = await encrypt_text(env, 'same input');
		const b = await encrypt_text(env, 'same input');
		expect(a).not.toBe(b);
	});
});
