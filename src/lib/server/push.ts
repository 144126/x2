import { b64u, unb64u } from '../b64';

export type PushKeys = { public: string; private: string; subject: string };
export type WebPushSub = { endpoint: string; keys: { p256dh: string; auth: string } };
export type PushOpts = {
	ttl?: number;
	urgency?: 'very-low' | 'low' | 'normal' | 'high';
	topic?: string;
};
export type PushResult = { ok: boolean; status: number; gone: boolean };

export const MAX_PLAINTEXT = 4096 - 16 - 4 - 1 - 65 - 16 - 1; // 3993

// TS's lib.dom types pin BufferSource to ArrayBuffer-backed views; Uint8Array's type
// parameter is the wider ArrayBufferLike. The views are always plain ArrayBuffers here.
const bs = (u: Uint8Array): BufferSource => u as unknown as BufferSource;

const ascii = (s: string) => new TextEncoder().encode(s);
const cat = (...parts: Uint8Array[]): Uint8Array => {
	const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	let at = 0;
	for (const p of parts) {
		out.set(p, at);
		at += p.length;
	}
	return out;
};

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

async function ecdh_import_private(d: Uint8Array, pub: Uint8Array) {
	return crypto.subtle.importKey(
		'jwk',
		{
			kty: 'EC',
			crv: 'P-256',
			d: b64u(d),
			x: b64u(pub.slice(1, 33)),
			y: b64u(pub.slice(33, 65)),
			ext: true
		},
		{ name: 'ECDH', namedCurve: 'P-256' },
		false,
		['deriveBits']
	);
}

export async function encrypt_payload(
	sub: WebPushSub,
	plaintext: string,
	seed?: { salt: Uint8Array; as_private: Uint8Array; as_public: Uint8Array }
): Promise<Uint8Array> {
	const bytes = ascii(plaintext);
	if (bytes.length > MAX_PLAINTEXT) throw new Error('plaintext too large for one aes128gcm record');

	const salt = seed?.salt ?? crypto.getRandomValues(new Uint8Array(16));
	let as_private: Uint8Array;
	let as_public: Uint8Array;
	if (seed) {
		as_private = seed.as_private;
		as_public = seed.as_public;
	} else {
		const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
			'deriveBits'
		]);
		as_public = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
		const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
		as_private = unb64u(jwk.d as string);
	}

	const ua_pub = unb64u(sub.keys.p256dh);
	const auth = unb64u(sub.keys.auth);

	const as_priv_key = await ecdh_import_private(as_private, as_public);
	const ua_pub_key = await crypto.subtle.importKey(
		'raw',
		bs(ua_pub),
		{ name: 'ECDH', namedCurve: 'P-256' },
		false,
		[]
	);
	const ecdh = new Uint8Array(
		await crypto.subtle.deriveBits({ name: 'ECDH', public: ua_pub_key }, as_priv_key, 256)
	);

	const prk_key = await hmac(auth, ecdh);
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

	const key = await crypto.subtle.importKey('raw', bs(cek), { name: 'AES-GCM' }, false, [
		'encrypt'
	]);
	const record = cat(bytes, new Uint8Array([2]));
	const ciphertext = new Uint8Array(
		await crypto.subtle.encrypt({ name: 'AES-GCM', iv: bs(nonce) }, key, bs(record))
	);

	const rs = new Uint8Array([0, 0, 0x10, 0]); // 4096, big-endian
	return cat(salt, rs, new Uint8Array([as_public.length]), as_public, ciphertext);
}

export async function vapid_auth(
	keys: PushKeys,
	endpoint: string,
	now = Date.now()
): Promise<string> {
	const header = b64u(ascii(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
	const claims = b64u(
		ascii(
			JSON.stringify({
				aud: new URL(endpoint).origin,
				exp: Math.floor(now / 1000) + 12 * 3600,
				sub: keys.subject
			})
		)
	);
	const pub = unb64u(keys.public);
	const priv = await crypto.subtle.importKey(
		'jwk',
		{
			kty: 'EC',
			crv: 'P-256',
			d: keys.private,
			x: b64u(pub.slice(1, 33)),
			y: b64u(pub.slice(33, 65)),
			ext: true
		},
		{ name: 'ECDSA', namedCurve: 'P-256' },
		false,
		['sign']
	);
	const signing_input = `${header}.${claims}`;
	const sig = new Uint8Array(
		await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, priv, bs(ascii(signing_input)))
	);
	return `vapid t=${signing_input}.${b64u(sig)},k=${keys.public}`;
}

export function push_topic(conv: string): string {
	const fnv = (seed: number) => {
		let h = seed;
		for (let i = 0; i < conv.length; i++) {
			h ^= conv.charCodeAt(i);
			h = Math.imul(h, 0x01000193);
		}
		return (h >>> 0).toString(16).padStart(8, '0');
	};
	return fnv(0x811c9dc5) + fnv(0x1000193);
}

export function clamp_payload(obj: Record<string, unknown>): string {
	let out = JSON.stringify(obj);
	if (out.length <= MAX_PLAINTEXT) return out;
	const body = typeof obj.body === 'string' ? obj.body : '';
	const overhead = out.length - body.length;
	// '…' is 3 UTF-8 bytes but 1 JS string unit — leave slack since encrypt_payload
	// measures UTF-8 byte length, not JS string length.
	let budget = MAX_PLAINTEXT - overhead - 8;
	if (budget < 0) budget = 0;
	out = JSON.stringify({ ...obj, body: body.slice(0, budget) + '…' });
	if (out.length <= MAX_PLAINTEXT) return out;
	// an oversized non-body field: fall back to truncating the whole serialization's fields
	const shrunk: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(obj)) {
		shrunk[k] = typeof v === 'string' && v.length > 200 ? v.slice(0, 200) + '…' : v;
	}
	out = JSON.stringify(shrunk);
	return out.length <= MAX_PLAINTEXT ? out : out.slice(0, MAX_PLAINTEXT);
}

export async function send_push(
	sub: WebPushSub,
	payload: string,
	keys: PushKeys,
	opts: PushOpts = {},
	f: typeof fetch = fetch
): Promise<PushResult> {
	const body = await encrypt_payload(sub, payload);
	const headers: Record<string, string> = {
		'Content-Encoding': 'aes128gcm',
		'Content-Type': 'application/octet-stream',
		'Content-Length': String(body.byteLength),
		TTL: String(opts.ttl ?? 86400),
		Urgency: opts.urgency ?? 'high',
		Authorization: await vapid_auth(keys, sub.endpoint)
	};
	if (opts.topic) headers.Topic = opts.topic;

	const attempt = async (): Promise<Response | null> => {
		try {
			return await f(sub.endpoint, { method: 'POST', headers, body: bs(body) as BodyInit });
		} catch {
			return null;
		}
	};

	let res = await attempt();
	if (res && [429, 500, 503].includes(res.status)) res = await attempt();
	if (!res) return { ok: false, status: 0, gone: false };
	const gone = res.status === 404 || res.status === 410;
	return { ok: res.ok, status: res.status, gone };
}
