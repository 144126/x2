import { get_secret, b64u, unb64u, type SecretVal } from './qdrant';

async function get_key(secret: string): Promise<CryptoKey> {
	const raw = new TextEncoder().encode(secret).slice(0, 32);
	return crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, [
		'sign',
		'verify'
	]);
}

export type SessionUser = { id: string; username: string; picture?: string; email?: string };

export async function encode_session(secret: SecretVal, data: SessionUser): Promise<string> {
	const p = {
		u: data.id,
		n: data.username,
		p: data.picture,
		m: data.email,
		e: Date.now() + 604800000
	};
	const raw = b64u(new TextEncoder().encode(JSON.stringify(p)));
	const k = await get_key(await get_secret(secret));
	const sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(raw));
	return raw + '.' + b64u(sig);
}

export async function decode_session(
	secret: SecretVal,
	c: string | undefined | null
): Promise<{ user: SessionUser } | null> {
	if (!c) return null;
	const [raw, sig] = c.split('.');
	if (!raw || !sig) return null;
	try {
		const k = await get_key(await get_secret(secret));
		const sig_buf = unb64u(sig).buffer as ArrayBuffer;
		const valid = await crypto.subtle.verify('HMAC', k, sig_buf, new TextEncoder().encode(raw));
		if (!valid) return null;
		const p = JSON.parse(new TextDecoder().decode(unb64u(raw)));
		if (p.e < Date.now()) return null;
		return { user: { id: p.u, username: p.n, picture: p.p, email: p.m } };
	} catch {
		return null;
	}
}
