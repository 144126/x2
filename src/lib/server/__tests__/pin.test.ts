import { describe, it, expect } from 'vitest';
import {
	valid_pin,
	hash_pin,
	verify_pin,
	encode_unlock,
	decode_unlock,
	unlocks,
	lockout_ms,
	open_while_locked,
	IDLE_MS
} from '../pin';

const S = 'a-server-secret-long-enough-to-key';
const UID = 'u-1';

describe('pin shape', () => {
	it('takes 4 to 12 digits and nothing else', () => {
		expect(valid_pin('1234')).toBe(true);
		expect(valid_pin('123456789012')).toBe(true);
		expect(valid_pin('123')).toBe(false);
		expect(valid_pin('1234567890123')).toBe(false);
		expect(valid_pin('12a4')).toBe(false);
		expect(valid_pin('')).toBe(false);
		expect(valid_pin(1234)).toBe(false);
	});
});

describe('stored pin', () => {
	it('verifies the right pin and rejects the rest', async () => {
		const h = await hash_pin(S, UID, '4816');
		expect(await verify_pin(S, UID, '4816', h)).toBe(true);
		expect(await verify_pin(S, UID, '4817', h)).toBe(false);
		expect(await verify_pin(S, UID, '', h)).toBe(false);
		expect(await verify_pin(S, UID, '4816', undefined)).toBe(false);
	});

	it('is useless without the server secret, so a dumped record cannot be cracked', async () => {
		const h = await hash_pin(S, UID, '4816');
		expect(await verify_pin('a-different-server-secret-entirely', UID, '4816', h)).toBe(false);
	});

	it('gives two accounts different stored values for the same pin', async () => {
		const a = await hash_pin(S, 'u-1', '4816');
		expect(await verify_pin(S, 'u-2', '4816', a)).toBe(false);
	});
});

describe('unlock token', () => {
	it('round trips and names the user and pin version', async () => {
		const t = await encode_unlock(S, UID, 3);
		const d = await decode_unlock(S, t);
		expect(unlocks(d, UID, 3)).toBe(true);
	});

	it('does not unlock a different account', async () => {
		const d = await decode_unlock(S, await encode_unlock(S, UID, 3));
		expect(unlocks(d, 'someone-else', 3)).toBe(false);
	});

	it('dies when the pin changes, because the version moves with it', async () => {
		const d = await decode_unlock(S, await encode_unlock(S, UID, 3));
		expect(unlocks(d, UID, 4)).toBe(false);
	});

	it('expires once the idle window passes', async () => {
		const t = await encode_unlock(S, UID, 1, 1_000_000);
		expect(await decode_unlock(S, t, 1_000_000 + IDLE_MS - 1)).not.toBeNull();
		expect(await decode_unlock(S, t, 1_000_000 + IDLE_MS + 1)).toBeNull();
	});

	it('refuses a forged or edited token', async () => {
		const t = await encode_unlock(S, UID, 1);
		const [raw, sig] = t.split('.');
		expect(await decode_unlock(S, `${raw}.${sig.slice(0, -2)}xx`)).toBeNull();
		expect(await decode_unlock(S, 'nonsense')).toBeNull();
		expect(await decode_unlock(S, '')).toBeNull();
		expect(await decode_unlock('another-secret-entirely-here', t)).toBeNull();
	});

	it('refuses a token minted by someone who guessed the payload but not the key', async () => {
		const raw = btoa(JSON.stringify({ u: UID, v: 1, e: Date.now() + 1000 }));
		expect(await decode_unlock(S, `${raw}.${raw}`)).toBeNull();
	});
});

describe('lockout', () => {
	it('is free for the first four misses, then grows and caps', () => {
		expect(lockout_ms(0)).toBe(0);
		expect(lockout_ms(4)).toBe(0);
		expect(lockout_ms(5)).toBe(30_000);
		expect(lockout_ms(6)).toBe(60_000);
		expect(lockout_ms(9)).toBe(3_600_000);
		expect(lockout_ms(500)).toBe(3_600_000);
	});
});

describe('what a locked browser may still reach', () => {
	it('allows the lock screen, the ways out, and the shell it is built from', () => {
		for (const p of [
			'/lock',
			'/login',
			'/logout',
			'/google',
			'/offline',
			'/api/pin/unlock',
			'/api/pin/lock',
			'/api/pin/reset',
			'/_app/immutable/chunks/x.js',
			'/icons/icon-192.png',
			'/app.css',
			'/manifest.webmanifest',
			'/service-worker.js'
		])
			expect(open_while_locked(p)).toBe(true);
	});

	it('refuses everything that carries the account', () => {
		for (const p of [
			'/',
			'/chats',
			'/chat/abc',
			'/find',
			'/me',
			'/rooms',
			'/~room',
			'/@ada',
			'/media/some-key',
			'/api/messages',
			'/api/send',
			'/api/pin',
			'/api/wstoken',
			'/api/profile',
			// signing in again with a password must not be a way past the pin — the pin-reset
			// route is, and it clears the pin properly instead of routing around it
			'/api/auth/login'
		])
			expect(open_while_locked(p)).toBe(false);
	});

	it('judges a client-side navigation by its route, not its data url', () => {
		expect(open_while_locked('/chats/__data.json')).toBe(false);
		expect(open_while_locked('/lock/__data.json')).toBe(true);
		expect(open_while_locked('/__data.json')).toBe(false);
	});
});
