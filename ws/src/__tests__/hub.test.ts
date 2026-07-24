import { describe, it, expect } from 'vitest';
import { verify_token } from '../hub';

async function hexHmacLikeToken(uid: string, secret: string): Promise<string> {
	const raw = new TextEncoder().encode(`${uid}.${secret}`);
	const sig = await crypto.subtle.digest('SHA-256', raw);
	return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

describe('verify_token', () => {
	it('accepts a token computed the same way wstoken issues it', async () => {
		const token = await hexHmacLikeToken('uid-1', 'shared-secret');
		expect(await verify_token('shared-secret', 'uid-1', token)).toBe(true);
	});

	it('rejects a token for a different uid', async () => {
		const token = await hexHmacLikeToken('uid-1', 'shared-secret');
		expect(await verify_token('shared-secret', 'uid-2', token)).toBe(false);
	});

	it('rejects a token signed with a different secret', async () => {
		const token = await hexHmacLikeToken('uid-1', 'shared-secret');
		expect(await verify_token('other-secret', 'uid-1', token)).toBe(false);
	});

	it('rejects a garbage token', async () => {
		expect(await verify_token('shared-secret', 'uid-1', 'not-a-real-token')).toBe(false);
	});

	it('rejects when the secret is empty (misconfigured deployment)', async () => {
		const token = await hexHmacLikeToken('uid-1', '');
		expect(await verify_token('', 'uid-1', token)).toBe(false);
	});

	it('rejects when the token is empty', async () => {
		expect(await verify_token('shared-secret', 'uid-1', '')).toBe(false);
	});
});
