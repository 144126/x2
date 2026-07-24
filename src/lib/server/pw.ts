import { b64u, unb64u } from './qdrant';

const ITER = 120_000;

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
