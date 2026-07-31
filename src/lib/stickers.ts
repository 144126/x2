import manifest from '../../static/stickers/manifest.json';

export type Sticker = { id: string; file: string; keywords: string[]; pack: string };

export const STICKERS: Sticker[] = manifest.packs.flatMap((p) =>
	p.stickers.map((s) => ({ ...s, pack: p.id }))
);

export function sticker_src(id: string): string | undefined {
	const s = STICKERS.find((x) => x.id === id);
	return s ? `/stickers/${s.file}` : undefined;
}

export function search_stickers(q: string): Sticker[] {
	const needle = q.trim().toLowerCase();
	if (!needle) return STICKERS;
	return STICKERS.filter((s) => s.id.includes(needle) || s.keywords.some((k) => k.includes(needle)));
}
