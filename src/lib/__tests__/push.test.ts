import { describe, it, expect } from 'vitest';
import { clamp_payload, MAX_PLAINTEXT } from '../server/push';

const bytes = (s: string): number => new TextEncoder().encode(s).length;

describe('clamp_payload', () => {
	it('returns the input unchanged when it already fits', () => {
		expect(clamp_payload({ a: 'x' })).toBe(JSON.stringify({ a: 'x' }));
	});

	it('truncates a long ASCII body to fit under the byte budget', () => {
		const out = clamp_payload({ body: 'a'.repeat(5000) });
		expect(bytes(out)).toBeLessThanOrEqual(MAX_PLAINTEXT);
		expect(JSON.parse(out).body.endsWith('…')).toBe(true);
	});

	it('truncates an emoji-heavy body to fit — the old JS-length budget overflowed', () => {
		const out = clamp_payload({ body: '😀'.repeat(1500) });
		expect(bytes(out)).toBeLessThanOrEqual(MAX_PLAINTEXT);
	});

	it('truncates an oversized non-body field', () => {
		const out = clamp_payload({ a: 'z'.repeat(500) });
		expect(bytes(out)).toBeLessThanOrEqual(MAX_PLAINTEXT);
	});
});
