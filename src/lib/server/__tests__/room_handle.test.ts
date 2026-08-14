import { describe, it, expect } from 'vitest';
import { normalize_handle, available_handle } from '../room_handle';

const free = async () => false;
const taken_but = (ok: RegExp) => async (h: string) => !ok.test(h);

describe('normalize_handle', () => {
	it('turns a room name into the handle its url is built from', () => {
		expect(normalize_handle('Chess Club')).toBe('chess-club');
	});

	it('collapses punctuation and spacing into single hyphens', () => {
		expect(normalize_handle("Ada's  Book — Club!!")).toBe('ada-s-book-club');
	});

	it('never starts or ends on a hyphen', () => {
		expect(normalize_handle('  ...lagos nights...  ')).toBe('lagos-nights');
	});

	it('cuts a long name back to a whole word rather than mid-syllable', () => {
		const h = normalize_handle('Lagos Nigeria Cooking Enthusiasts Society');
		expect(h.length).toBeLessThanOrEqual(30);
		expect(h).toBe('lagos-nigeria-cooking');
	});

	it('hard-cuts a single long word, since there is no word boundary to fall back on', () => {
		expect(normalize_handle('a'.repeat(40))).toBe('a'.repeat(30));
	});

	it('returns nothing for a name with no usable characters', () => {
		expect(normalize_handle('🎧🎧🎧')).toBe('');
	});
});

describe('available_handle', () => {
	it('gives the clean handle to whoever asks first', async () => {
		expect(await available_handle('Chess Club', free)).toBe('chess-club');
	});

	it('adds two random digits once the clean handle is gone', async () => {
		expect(await available_handle('Chess Club', taken_but(/^chess-club-\d{2}$/))).toMatch(
			/^chess-club-\d{2}$/
		);
	});

	it('widens past two digits when every two-digit try is also gone', async () => {
		expect(await available_handle('Chess Club', async () => true)).toMatch(/^chess-club-\d{4}$/);
	});

	it('names a room something usable even when the name is all emoji', async () => {
		expect(await available_handle('🎧🎧🎧', free)).toBe('room');
	});

	it('pads a name too short to stand on its own', async () => {
		expect(await available_handle('go', free)).toMatch(/^go-\d{2}$/);
	});

	it('keeps the handle inside its length cap once the digits are on', async () => {
		const h = await available_handle('Lagos Nigeria Cooking Enthusiasts', async () => true);
		expect(h.length).toBeLessThanOrEqual(30);
		expect(h).not.toContain('--');
	});
});
