import { describe, it, expect } from 'vitest';
import { verify_token } from '../hub';

const SECRET = 'shared-secret';

async function make_token(uid: string, exp: number, secret: string): Promise<string> {
	const k = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(secret).slice(0, 32),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	const raw = new TextEncoder().encode(`${uid}.${exp}`);
	const sig = await crypto.subtle.sign('HMAC', k, raw);
	return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

describe('verify_token', () => {
	it('accepts a valid HMAC token within expiry', async () => {
		const exp = Date.now() + 60_000;
		const t = await make_token('u1', exp, SECRET);
		expect(await verify_token(SECRET, 'u1', exp, t)).toBe(true);
	});

	it('rejects an expired token', async () => {
		const exp = Date.now() - 1000;
		const t = await make_token('u1', exp, SECRET);
		expect(await verify_token(SECRET, 'u1', exp, t)).toBe(false);
	});

	it('rejects a token signed for a different uid', async () => {
		const exp = Date.now() + 60_000;
		const t = await make_token('u2', exp, SECRET);
		expect(await verify_token(SECRET, 'u1', exp, t)).toBe(false);
	});

	it('rejects a token signed with a different secret', async () => {
		const exp = Date.now() + 60_000;
		const t = await make_token('u1', exp, 'other-secret');
		expect(await verify_token(SECRET, 'u1', exp, t)).toBe(false);
	});

	it('rejects a garbage token', async () => {
		expect(await verify_token(SECRET, 'u1', Date.now() + 60_000, 'garbage')).toBe(false);
	});

	it('rejects when the secret is empty', async () => {
		const exp = Date.now() + 60_000;
		expect(await verify_token('', 'u1', exp, '')).toBe(false);
	});

	it('rejects when exp is 0 or missing', async () => {
		const exp = Date.now() + 60_000;
		const t = await make_token('u1', exp, SECRET);
		expect(await verify_token(SECRET, 'u1', 0, t)).toBe(false);
	});
});
