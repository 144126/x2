import { describe, it, expect } from 'vitest';
import { STICKERS, sticker_src, search_stickers, custom_id } from '../stickers';

describe('sticker manifest', () => {
	it('loads stickers from the static manifest', () => {
		expect(STICKERS.length).toBeGreaterThan(0);
	});
	it('every sticker has a non-empty id, file, keywords and pack', () => {
		expect(STICKERS.every((s) => s.id && s.file && s.keywords.length && s.pack)).toBe(true);
	});
	it('sticker_src resolves a known id to its served path', () => {
		expect(sticker_src('wave')).toBe('/stickers/basics/wave.svg');
	});
	it('sticker_src returns undefined for an unknown id', () => {
		expect(sticker_src('nope')).toBeUndefined();
	});
	it('sticker_src serves a sticker someone made from their uploaded media', () => {
		expect(sticker_src(custom_id('img/abc.webp'))).toBe('/media/img/abc.webp');
	});
	it('custom_id round-trips through sticker_src without hitting the manifest', () => {
		expect(custom_id('k1')).toBe('u:k1');
		expect(sticker_src('u:k1')).toBe('/media/k1');
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
