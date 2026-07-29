import { b64u, unb64u } from './qdrant';

// Cloudflare Workers' crypto.subtle caps PBKDF2 at 100,000 iterations (Node's WebCrypto has
// no such cap, so this only breaks under the real Workers runtime, e.g. `NotSupportedError`
// in prod even though local tests/dev pass).
const ITER = 100_000;

export async function hash_pw(pw: string): Promise<string> {
	const salt = crypto.getRandomValues(new Uint8Array(16));
	const key = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(pw) as BufferSource,
		'PBKDF2',
		false,
		['deriveBits']
	);
	const bits = await crypto.subtle.deriveBits(
		{ name: 'PBKDF2', salt: salt as BufferSource, iterations: ITER, hash: 'SHA-256' },
		key,
		256
	);
	return `${b64u(salt)}.${b64u(bits)}`;
}

export async function verify_pw(pw: string, stored: string): Promise<boolean> {
	const [s, h] = stored.split('.');
	if (!s || !h) return false;
	const salt = unb64u(s);
	const key = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(pw) as BufferSource,
		'PBKDF2',
		false,
		['deriveBits']
	);
	const bits = await crypto.subtle.deriveBits(
		{ name: 'PBKDF2', salt: salt as BufferSource, iterations: ITER, hash: 'SHA-256' },
		key,
		256
	);
	return b64u(bits) === h;
}
