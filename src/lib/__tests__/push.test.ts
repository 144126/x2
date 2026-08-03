import { describe, it, expect, vi } from 'vitest';
import { clamp_payload, MAX_PLAINTEXT, send_push } from '../server/push';

const bytes = (s: string): number => new TextEncoder().encode(s).length;

// a real 65-byte P-256 point (0x04 prefix, on-curve — exported from a generated keypair)
const P256DH =
	'BCZLrELsZXVOuRNyEpmXypQmMnVqtg6d_rqpwkTmb6SAR3Wo5eS7kxfaPPEYldVLd-LYzO7pRSWg3kljcvwh6sk';
const AUTH = 'reBg-YN5Ix6V6pKwKxHB6g';
// a real generated P-256 VAPID pair (public point + private d), or vapid_auth's jwk import throws
const KEYS = {
	public: 'BCZLrELsZXVOuRNyEpmXypQmMnVqtg6d_rqpwkTmb6SAR3Wo5eS7kxfaPPEYldVLd-LYzO7pRSWg3kljcvwh6sk',
	private: '7Nx5If2-fhz7fPd4kMzWiGsS6MGpM9ayoRcSonV22rs',
	subject: 'mailto:dev@example.com'
};
const b64u = (buf: Uint8Array): string =>
	Buffer.from(buf).toString('base64url').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

describe('clamp_payload', () => {
	it('returns the input unchanged when it already fits', () => {
		expect(clamp_payload({ a: 'x' })).toBe(JSON.stringify({ a: 'x' }));
	});

	it('truncates a long ASCII body to fit under the byte budget', () => {
		const out = clamp_payload({ body: 'a'.repeat(5000) });
		expect(bytes(out)).toBeLessThanOrEqual(MAX_PLAINTEXT);
		expect(JSON.parse(out).body.endsWith('…')).toBe(true);
	});

	it('truncates an emoji-heavy body to fit — the old JS-length budget overflowed', () => {
		const out = clamp_payload({ body: '😀'.repeat(1500) });
		expect(bytes(out)).toBeLessThanOrEqual(MAX_PLAINTEXT);
	});

	it('truncates an oversized non-body field', () => {
		const out = clamp_payload({ a: 'z'.repeat(500) });
		expect(bytes(out)).toBeLessThanOrEqual(MAX_PLAINTEXT);
	});
});

describe('send_push', () => {
	it('returns gone (no throw) for a subscription whose p256dh is not a valid P-256 point', async () => {
		const bad = new Uint8Array(65);
		crypto.getRandomValues(bad);
		bad[0] = 0x01;
		const f = vi.fn();
		const r = await send_push(
			{ endpoint: 'https://push.example.net/push/a', keys: { p256dh: b64u(bad), auth: AUTH } },
			JSON.stringify({ a: 'x' }),
			KEYS,
			{},
			f
		);
		expect(r).toEqual({ ok: false, status: 0, gone: true });
		expect(f).not.toHaveBeenCalled();
	});

	it('returns gone for a subscription with a malformed endpoint URL', async () => {
		const f = vi.fn();
		const r = await send_push(
			{ endpoint: 'not-a-url', keys: { p256dh: P256DH, auth: AUTH } },
			JSON.stringify({ a: 'x' }),
			KEYS,
			{},
			f
		);
		expect(r).toEqual({ ok: false, status: 0, gone: true });
		expect(f).not.toHaveBeenCalled();
	});

	it('skips (does not prune) an oversized plaintext', async () => {
		const f = vi.fn();
		const r = await send_push(
			{ endpoint: 'https://push.example.net/push/a', keys: { p256dh: P256DH, auth: AUTH } },
			'a'.repeat(5000),
			KEYS,
			{},
			f
		);
		expect(r).toEqual({ ok: false, status: 0, gone: false });
		expect(f).not.toHaveBeenCalled();
	});

	it('sends an encrypted push for a well-formed subscription', async () => {
		const f = vi.fn().mockResolvedValue(new Response(null, { status: 201 }));
		const r = await send_push(
			{ endpoint: 'https://push.example.net/push/a', keys: { p256dh: P256DH, auth: AUTH } },
			JSON.stringify({ a: 'x' }),
			KEYS,
			{},
			f
		);
		expect(f).toHaveBeenCalledTimes(1);
		const headers = f.mock.calls[0][1].headers as Record<string, string>;
		expect(headers['Content-Encoding']).toBe('aes128gcm');
		expect(headers.Authorization.startsWith('vapid t=')).toBe(true);
		expect(r).toEqual({ ok: true, status: 201, gone: false });
	});
});

describe('valid_sub', () => {
	it('accepts a well-formed https subscription', async () => {
		const { valid_sub } = await import('../server/push');
		expect(valid_sub('https://push.example.net/push/a', P256DH, AUTH)).toBe(true);
	});

	it('rejects a non-https endpoint', async () => {
		const { valid_sub } = await import('../server/push');
		expect(valid_sub('http://push.example.net/a', P256DH, AUTH)).toBe(false);
	});

	it('rejects a malformed endpoint', async () => {
		const { valid_sub } = await import('../server/push');
		expect(valid_sub('not-a-url', P256DH, AUTH)).toBe(false);
	});

	it('rejects a p256dh that is not a 65-byte 0x04 P-256 point', async () => {
		const { valid_sub } = await import('../server/push');
		expect(valid_sub('https://push.example.net/push/a', b64u(new Uint8Array(64)), AUTH)).toBe(
			false
		);
		expect(valid_sub('https://push.example.net/push/a', b64u(new Uint8Array(65)), AUTH)).toBe(
			false
		);
	});

	it('rejects an auth that is not 16 bytes', async () => {
		const { valid_sub } = await import('../server/push');
		expect(valid_sub('https://push.example.net/push/a', P256DH, b64u(new Uint8Array(15)))).toBe(
			false
		);
	});
});
