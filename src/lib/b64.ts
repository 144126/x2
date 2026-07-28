// base64url, shared by server (qdrant ids, push crypto) and browser (push-client).
// Lives outside server/ so importing it does not drag the qdrant client into the client bundle.
export const b64u = (buf: ArrayBuffer | Uint8Array): string => {
	const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
	let s = '';
	for (const b of bytes) s += String.fromCharCode(b);
	return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

export const unb64u = (s: string): Uint8Array => {
	const t = s.replace(/-/g, '+').replace(/_/g, '/');
	const bin = atob(t.padEnd(Math.ceil(t.length / 4) * 4, '='));
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
};
