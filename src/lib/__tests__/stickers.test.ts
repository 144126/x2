import { describe, it, expect } from 'vitest';
import { STICKERS, sticker_src, search_stickers } from '../stickers';

describe('sticker manifest', () => {
	it('loads stickers from the static manifest', () => {
		expect(STICKERS.length).toBeGreaterThan(0);
	});
	it('every sticker has a non-empty id, file, keywords and pack', () => {
		expect(
			STICKERS.every((s) => s.id && s.file && s.keywords.length && s.pack)
		).toBe(true);
	});
	it('sticker_src resolves a known id to its served path', () => {
		expect(sticker_src('wave')).toBe('/stickers/basics/wave.webp');
	});
	it('sticker_src returns undefined for an unknown id', () => {
		expect(sticker_src('nope')).toBeUndefined();
	});
	it('search_stickers matches by id', () => {
		expect(search_stickers('wave').some((s) => s.id === 'wave')).toBe(true);
	});
	it('search_stickers matches by keyword', () => {
		expect(search_stickers('hello').some((s) => s.id === 'wave')).toBe(true);
	});
	it('empty query returns the full set', () => {
		expect(search_stickers('').length).toBe(STICKERS.length);
	});
});
