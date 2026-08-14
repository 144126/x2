import manifest from '../../static/stickers/manifest.json';

export type Sticker = { id: string; file: string; keywords: string[]; pack: string };

export const STICKERS: Sticker[] = manifest.packs.flatMap((p) =>
	p.stickers.map((s) => ({ ...s, pack: p.id }))
);

/** a sticker someone made themselves is `u:<media key>`; the built-in pack is plain ids */
export const CUSTOM = 'u:';

export const custom_id = (key: string): string => CUSTOM + key;

/** a searched sticker travels as its own klipy url, so the host is checked on the way in and
 * again on the way out — an unchecked url lets a sender aim an <img> at a host they own and
 * collect the ip of everyone who opens the chat */
export function remote_ok(id: string): boolean {
	try {
		const u = new URL(id);
		return u.protocol === 'https:' && /(^|\.)klipy\.com$/.test(u.hostname);
	} catch {
		return false;
	}
}

export function sticker_src(id: string): string | undefined {
	if (id.startsWith('https://')) return remote_ok(id) ? id : undefined;
	if (id.startsWith(CUSTOM)) return `/media/${id.slice(CUSTOM.length)}`;
	const s = STICKERS.find((x) => x.id === id);
	return s ? `/stickers/${s.file}` : undefined;
}

export function search_stickers(q: string): Sticker[] {
	const needle = q.trim().toLowerCase();
	if (!needle) return STICKERS;
	return STICKERS.filter(
		(s) => s.id.includes(needle) || s.keywords.some((k) => k.includes(needle))
	);
}
