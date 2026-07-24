import { describe, it, expect } from 'vitest';
import { hash_pw, verify_pw } from '../pw';

describe('hash_pw / verify_pw', () => {
	it('verifies the correct password', async () => {
		const hash = await hash_pw('correct horse battery staple');
		expect(await verify_pw('correct horse battery staple', hash)).toBe(true);
	});

	it('rejects an incorrect password', async () => {
		const hash = await hash_pw('correct horse battery staple');
		expect(await verify_pw('wrong password', hash)).toBe(false);
	});

	it('produces a different hash each time (random salt)', async () => {
		const a = await hash_pw('same-password');
		const b = await hash_pw('same-password');
		expect(a).not.toBe(b);
		expect(await verify_pw('same-password', a)).toBe(true);
		expect(await verify_pw('same-password', b)).toBe(true);
	});

	it('stores salt and hash separated by a dot', async () => {
		const hash = await hash_pw('x');
		const parts = hash.split('.');
		expect(parts).toHaveLength(2);
		expect(parts[0]).not.toBe('');
		expect(parts[1]).not.toBe('');
	});

	it('rejects malformed stored hashes', async () => {
		expect(await verify_pw('anything', 'not-a-valid-hash')).toBe(false);
		expect(await verify_pw('anything', '')).toBe(false);
		expect(await verify_pw('anything', 'onlyonepart')).toBe(false);
	});

	it('is case- and whitespace-sensitive', async () => {
		const hash = await hash_pw('Secret123');
		expect(await verify_pw('secret123', hash)).toBe(false);
		expect(await verify_pw('Secret123 ', hash)).toBe(false);
	});
});
