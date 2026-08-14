import { describe, it, expect } from 'vitest';
import { friendly_handle } from '../handle';

describe('friendly_handle', () => {
	it('is a legal username you could say out loud', async () => {
		const h = await friendly_handle('3dfcae71-f891-4e65-a123-000000000000');
		expect(h).toMatch(/^[a-z]+_[a-z]+_\d{1,2}$/);
		expect(h.length).toBeLessThanOrEqual(20);
	});

	it('is stable for the same device', async () => {
		expect(await friendly_handle('seed-a')).toBe(await friendly_handle('seed-a'));
	});

	it('differs between devices', async () => {
		expect(await friendly_handle('seed-a')).not.toBe(await friendly_handle('seed-b'));
	});

	it('spreads across the word lists rather than collapsing onto one name', async () => {
		const seen = new Set<string>();
		for (let i = 0; i < 60; i++) seen.add(await friendly_handle(`device-${i}`));
		expect(seen.size).toBeGreaterThan(50);
	});
});
