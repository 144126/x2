import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	MAX_PLAINTEXT,
	clamp_payload,
	encrypt_payload,
	push_topic,
	send_push,
	vapid_auth,
	type PushKeys,
	type WebPushSub
} from '../push';

// ── local base64url, so the tests never lean on the module under test ──────────
const dec = (s: string): Uint8Array => {
	const t = s.replace(/-/g, '+').replace(/_/g, '/');
	const bin = atob(t.padEnd(Math.ceil(t.length / 4) * 4, '='));
	return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};
const enc = (b: Uint8Array): string =>
	btoa(String.fromCharCode(...b))
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/, '');

// ── RFC 8291 §5, "Push Message Encryption Example" ────────────────────────────
const RFC = {
	plaintext: 'When I grow up, I want to be a watermelon',
	ua_private: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
	ua_public:
		'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
	auth: 'BTBZMqHH6r4Tts7J_aSIgg',
	as_private: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
	as_public:
		'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
	salt: 'DGv6ra1nlYgDzR9GBDl9NQ'
};

const rfc_sub: WebPushSub = {
	endpoint: 'https://push.example.net/push/JzLQ3raZJfFBR0aqvOMsLrt54w4rJUsV',
	keys: { p256dh: RFC.ua_public, auth: RFC.auth }
};

// ── an independent receiver-side implementation of RFC 8291 + RFC 8188 ────────
// If encrypt_payload and this decryptor agree, the sender half is correct.
const bs = (u: Uint8Array): BufferSource => u as unknown as BufferSource;

async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
	const k = await crypto.subtle.importKey(
		'raw',
		bs(key),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	return new Uint8Array(await crypto.subtle.sign('HMAC', k, bs(data)));
}
const cat = (...parts: Uint8Array[]): Uint8Array => {
	const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	let at = 0;
	for (const p of parts) {
		out.set(p, at);
		at += p.length;
	}
	return out;
};
const ascii = (s: string) => new TextEncoder().encode(s);

async function rfc8291_decrypt(body: Uint8Array): Promise<string> {
	const salt = body.slice(0, 16);
	const idlen = body[20];
	const as_public = body.slice(21, 21 + idlen);
	const ciphertext = body.slice(21 + idlen);

	const ua_pub = dec(RFC.ua_public);
	const priv = await crypto.subtle.importKey(
		'jwk',
		{
			kty: 'EC',
			crv: 'P-256',
			d: RFC.ua_private,
			x: enc(ua_pub.slice(1, 33)),
			y: enc(ua_pub.slice(33, 65)),
			ext: true
		},
		{ name: 'ECDH', namedCurve: 'P-256' },
		false,
		['deriveBits']
	);
	const pub = await crypto.subtle.importKey(
		'raw',
		as_public,
		{ name: 'ECDH', namedCurve: 'P-256' },
		false,
		[]
	);
	const shared = new Uint8Array(
		await crypto.subtle.deriveBits({ name: 'ECDH', public: pub }, priv, 256)
	);

	const prk_key = await hmac(dec(RFC.auth), shared);
	const ikm = await hmac(
		prk_key,
		cat(ascii('WebPush: info'), new Uint8Array([0]), ua_pub, as_public, new Uint8Array([1]))
	);
	const prk = await hmac(salt, ikm);
	const cek = (
		await hmac(prk, cat(ascii('Content-Encoding: aes128gcm'), new Uint8Array([0, 1])))
	).slice(0, 16);
	const nonce = (
		await hmac(prk, cat(ascii('Content-Encoding: nonce'), new Uint8Array([0, 1])))
	).slice(0, 12);

	const key = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['decrypt']);
	const plain = new Uint8Array(
		await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, ciphertext)
	);
	let end = plain.length;
	while (end > 0 && plain[end - 1] === 0) end--; // trailing zero padding
	return new TextDecoder().decode(plain.slice(0, end - 1)); // drop the 0x02 delimiter
}

async function fresh_vapid(): Promise<PushKeys> {
	const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
		'sign',
		'verify'
	]);
	const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
	const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
	return { public: enc(raw), private: jwk.d as string, subject: 'mailto:hi@x2.studio' };
}

describe('encrypt_payload — RFC 8291 aes128gcm', () => {
	const seed = {
		salt: dec(RFC.salt),
		as_private: dec(RFC.as_private),
		as_public: dec(RFC.as_public)
	};

	it('frames the body exactly as RFC 8188 specifies', async () => {
		const body = await encrypt_payload(rfc_sub, RFC.plaintext, seed);

		expect([...body.slice(0, 16)]).toEqual([...dec(RFC.salt)]); // salt
		expect([...body.slice(16, 20)]).toEqual([0, 0, 0x10, 0]); // rs = 4096, big-endian
		expect(body[20]).toBe(65); // keyid length
		expect([...body.slice(21, 86)]).toEqual([...dec(RFC.as_public)]); // application server key
	});

	it('produces a body the receiver can decrypt back to the plaintext', async () => {
		const body = await encrypt_payload(rfc_sub, RFC.plaintext, seed);
		expect(await rfc8291_decrypt(body)).toBe(RFC.plaintext);
	});

	it('sizes the record as header + plaintext + delimiter + GCM tag', async () => {
		const body = await encrypt_payload(rfc_sub, RFC.plaintext, seed);
		expect(body.length).toBe(86 + RFC.plaintext.length + 1 + 16);
	});

	it('round-trips with a freshly generated ephemeral key each call', async () => {
		const a = await encrypt_payload(rfc_sub, 'hello');
		const b = await encrypt_payload(rfc_sub, 'hello');
		// fresh salt + fresh application-server key ⇒ never byte-identical
		expect([...a.slice(0, 86)]).not.toEqual([...b.slice(0, 86)]);
	});

	it('handles a plaintext at the maximum allowed size', async () => {
		const big = 'x'.repeat(MAX_PLAINTEXT);
		const body = await encrypt_payload(rfc_sub, big, seed);
		expect(body.length).toBeLessThanOrEqual(4096);
	});

	it('refuses a plaintext larger than one record can carry', async () => {
		await expect(encrypt_payload(rfc_sub, 'x'.repeat(MAX_PLAINTEXT + 1))).rejects.toThrow();
	});
});

describe('vapid_auth — RFC 8292', () => {
	let keys: PushKeys;
	const now = 1_800_000_000_000;

	beforeEach(async () => {
		keys = await fresh_vapid();
	});

	const claims = (header: string) => {
		const jwt = /t=([^,]+)/.exec(header)![1];
		return JSON.parse(new TextDecoder().decode(dec(jwt.split('.')[1])));
	};

	it('returns a `vapid t=…,k=…` header carrying the public key', async () => {
		const h = await vapid_auth(keys, 'https://fcm.googleapis.com/fcm/send/abc123', now);
		expect(h).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+,k=[\w-]+$/);
		expect(h.endsWith(`,k=${keys.public}`)).toBe(true);
	});

	it('scopes `aud` to the push service origin, never the full endpoint', async () => {
		const h = await vapid_auth(keys, 'https://fcm.googleapis.com/fcm/send/abc123', now);
		expect(claims(h).aud).toBe('https://fcm.googleapis.com');
	});

	it('carries the configured contact as `sub`', async () => {
		const h = await vapid_auth(keys, 'https://push.example.net/x', now);
		expect(claims(h).sub).toBe('mailto:hi@x2.studio');
	});

	it('expires in the future but within the 24h push services allow', async () => {
		const c = claims(await vapid_auth(keys, 'https://push.example.net/x', now));
		expect(c.exp * 1000).toBeGreaterThan(now);
		expect(c.exp * 1000).toBeLessThanOrEqual(now + 86_400_000);
	});

	it('declares ES256 in the header', async () => {
		const h = await vapid_auth(keys, 'https://push.example.net/x', now);
		const jwt = /t=([^,]+)/.exec(h)![1];
		expect(JSON.parse(new TextDecoder().decode(dec(jwt.split('.')[0])))).toEqual({
			typ: 'JWT',
			alg: 'ES256'
		});
	});

	it('signs with the private key so the public key verifies it', async () => {
		const h = await vapid_auth(keys, 'https://push.example.net/x', now);
		const jwt = /t=([^,]+)/.exec(h)![1];
		const [head, body, sig] = jwt.split('.');
		const pub = await crypto.subtle.importKey(
			'raw',
			bs(dec(keys.public)),
			{ name: 'ECDSA', namedCurve: 'P-256' },
			false,
			['verify']
		);
		const ok = await crypto.subtle.verify(
			{ name: 'ECDSA', hash: 'SHA-256' },
			pub,
			bs(dec(sig)),
			bs(ascii(`${head}.${body}`))
		);
		expect(ok).toBe(true);
	});

	it('emits a raw 64-byte P-256 signature, not DER', async () => {
		const h = await vapid_auth(keys, 'https://push.example.net/x', now);
		const sig = /t=([^,]+)/.exec(h)![1].split('.')[2];
		expect(dec(sig).length).toBe(64);
	});
});

describe('clamp_payload', () => {
	it('leaves a small payload intact', () => {
		const out = clamp_payload({ title: 'ada', body: 'hi', url: '/app/chat/x' });
		expect(JSON.parse(out)).toEqual({ title: 'ada', body: 'hi', url: '/app/chat/x' });
	});

	it('truncates an oversized body so the payload still fits one record', () => {
		const out = clamp_payload({ title: 'ada', body: 'x'.repeat(9000), url: '/app/chat/x' });
		expect(out.length).toBeLessThanOrEqual(MAX_PLAINTEXT);
		expect(JSON.parse(out).title).toBe('ada');
		expect(JSON.parse(out).url).toBe('/app/chat/x');
	});

	it('marks a truncated body with an ellipsis', () => {
		const out = clamp_payload({ title: 'ada', body: 'x'.repeat(9000), url: '/u' });
		expect(JSON.parse(out).body.endsWith('…')).toBe(true);
	});

	it('survives non-body fields that are themselves oversized', () => {
		const out = clamp_payload({ title: 'y'.repeat(9000), body: 'hi', url: '/u' });
		expect(out.length).toBeLessThanOrEqual(MAX_PLAINTEXT);
		expect(() => JSON.parse(out)).not.toThrow();
	});
});

describe('push_topic', () => {
	it('is stable for a conversation', () => {
		expect(push_topic('a|b')).toBe(push_topic('a|b'));
	});

	it('differs between conversations', () => {
		expect(push_topic('a|b')).not.toBe(push_topic('a|c'));
	});

	it('stays within the 32-character URL-safe limit push services enforce', () => {
		const t = push_topic('g:' + 'x'.repeat(300));
		expect(t.length).toBeLessThanOrEqual(32);
		expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
	});
});

describe('send_push', () => {
	let keys: PushKeys;
	const sub: WebPushSub = {
		endpoint: 'https://push.example.net/push/abc',
		keys: { p256dh: RFC.ua_public, auth: RFC.auth }
	};

	beforeEach(async () => {
		keys = await fresh_vapid();
	});

	const ok = (status = 201) =>
		vi.fn().mockResolvedValue(new Response(null, { status, headers: {} }));

	it('POSTs the encrypted body to the subscription endpoint', async () => {
		const f = ok();
		await send_push(sub, '{"body":"hi"}', keys, {}, f);
		expect(f).toHaveBeenCalledTimes(1);
		const [url, init] = f.mock.calls[0];
		expect(url).toBe(sub.endpoint);
		expect(init.method).toBe('POST');
		expect(init.body.byteLength).toBeGreaterThan(86);
	});

	it('sends the aes128gcm content headers a push service requires', async () => {
		const f = ok();
		await send_push(sub, '{"body":"hi"}', keys, {}, f);
		const h = f.mock.calls[0][1].headers as Record<string, string>;
		expect(h['Content-Encoding']).toBe('aes128gcm');
		expect(h['Content-Type']).toBe('application/octet-stream');
		expect(h['Authorization']).toMatch(/^vapid t=/);
	});

	it('defaults to a 24h TTL and high urgency for a chat message', async () => {
		const f = ok();
		await send_push(sub, '{}', keys, {}, f);
		const h = f.mock.calls[0][1].headers as Record<string, string>;
		expect(h['TTL']).toBe('86400');
		expect(h['Urgency']).toBe('high');
	});

	it('passes an explicit TTL, urgency and topic through', async () => {
		const f = ok();
		await send_push(sub, '{}', keys, { ttl: 60, urgency: 'low', topic: 'abc' }, f);
		const h = f.mock.calls[0][1].headers as Record<string, string>;
		expect(h['TTL']).toBe('60');
		expect(h['Urgency']).toBe('low');
		expect(h['Topic']).toBe('abc');
	});

	it('omits Topic when none is given', async () => {
		const f = ok();
		await send_push(sub, '{}', keys, {}, f);
		expect('Topic' in (f.mock.calls[0][1].headers as object)).toBe(false);
	});

	it('reports success on 201', async () => {
		expect(await send_push(sub, '{}', keys, {}, ok(201))).toEqual({
			ok: true,
			status: 201,
			gone: false
		});
	});

	it('flags a 410 subscription as gone so the caller can prune it', async () => {
		expect(await send_push(sub, '{}', keys, {}, ok(410))).toMatchObject({ ok: false, gone: true });
	});

	it('flags a 404 subscription as gone', async () => {
		expect(await send_push(sub, '{}', keys, {}, ok(404))).toMatchObject({ ok: false, gone: true });
	});

	it('does not flag a 429 as gone — the subscription is still valid', async () => {
		expect(await send_push(sub, '{}', keys, {}, ok(429))).toMatchObject({ gone: false });
	});

	it('retries once on a 503 and succeeds on the retry', async () => {
		const f = vi
			.fn()
			.mockResolvedValueOnce(new Response(null, { status: 503 }))
			.mockResolvedValueOnce(new Response(null, { status: 201 }));
		expect(await send_push(sub, '{}', keys, {}, f)).toMatchObject({ ok: true });
		expect(f).toHaveBeenCalledTimes(2);
	});

	it('does not retry a permanent failure', async () => {
		const f = ok(410);
		await send_push(sub, '{}', keys, {}, f);
		expect(f).toHaveBeenCalledTimes(1);
	});

	it('survives a network error without throwing', async () => {
		const f = vi.fn().mockRejectedValue(new Error('offline'));
		expect(await send_push(sub, '{}', keys, {}, f)).toMatchObject({ ok: false, gone: false });
	});

	it('never sends a body larger than one 4096-byte record', async () => {
		const f = ok();
		await send_push(sub, clamp_payload({ body: 'x'.repeat(99_999) }), keys, {}, f);
		expect(f.mock.calls[0][1].body.byteLength).toBeLessThanOrEqual(4096);
	});
});
