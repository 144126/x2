import raw from 'emojibase-data/en/data.json';
import messages from 'emojibase-data/en/messages.json';

export type EmojiEntry = { emoji: string; label: string; tags: string[]; group: number };

export const EMOJIS: EmojiEntry[] = (
	raw as { emoji: string; label: string; tags?: string[]; group?: number }[]
)
	.filter((e) => e.group !== undefined)
	.map((e) => ({ emoji: e.emoji, label: e.label, tags: e.tags ?? [], group: e.group! }));

export const GROUPS: { key: number; label: string }[] = (
	messages as { groups: { message: string }[] }
).groups.map((g, i) => ({ key: i, label: g.message }));

export function search_emoji(q: string): EmojiEntry[] {
	const needle = q.trim().toLowerCase();
	if (!needle) return EMOJIS;
	return EMOJIS.filter((e) => e.label.includes(needle) || e.tags.some((t) => t.includes(needle)));
}
