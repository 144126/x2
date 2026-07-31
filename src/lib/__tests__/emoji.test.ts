import { describe, it, expect } from 'vitest';
import { EMOJIS, GROUPS, search_emoji } from '../emoji';

describe('emoji dataset', () => {
	it('loads a large, real emoji set', () => {
		expect(EMOJIS.length).toBeGreaterThan(1500);
	});
	it('every entry has a non-empty emoji character and label', () => {
		expect(EMOJIS.every((e) => e.emoji && e.label)).toBe(true);
	});
	it('loads real category labels', () => {
		expect(GROUPS.length).toBeGreaterThan(5);
		expect(GROUPS.some((g) => g.label.includes('smileys'))).toBe(true);
	});
	it('search_emoji matches by label substring', () => {
		expect(search_emoji('grinning').some((e) => e.emoji === '😀')).toBe(true);
	});
	it('search_emoji matches by tag, not just label', () => {
		expect(search_emoji('teeth').some((e) => e.label === 'grinning face')).toBe(true);
	});
	it('empty query returns the full set', () => {
		expect(search_emoji('').length).toBe(EMOJIS.length);
	});
});
