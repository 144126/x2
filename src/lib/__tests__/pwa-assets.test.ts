import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../../..');
const at = (p: string) => resolve(root, p);
const read = (p: string) => readFileSync(at(p), 'utf8');

const manifest = () => JSON.parse(read('static/manifest.webmanifest'));

function png_size(p: string): { w: number; h: number } {
	const b = readFileSync(at(p));
	expect([...b.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
	return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

describe('manifest', () => {
	it('is valid JSON', () => {
		expect(() => manifest()).not.toThrow();
	});

	it('ships the 192 and 512 PNGs installability requires', () => {
		const icons = (manifest().icons ?? []) as { src: string; sizes: string; purpose?: string }[];
		const any = icons.filter((i) => (i.purpose ?? 'any').includes('any'));
		expect(any.map((i) => i.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
	});

	it('points at files that actually exist', () => {
		const icons = (manifest().icons ?? []) as { src: string }[];
		for (const i of icons) expect(existsSync(at(`static${i.src}`))).toBe(true);
	});

	it('declares sizes that match the real pixel dimensions', () => {
		const icons = (manifest().icons ?? []) as { src: string; sizes: string }[];
		for (const i of icons) {
			const [w, h] = i.sizes.split('x').map(Number);
			expect(png_size(`static${i.src}`)).toEqual({ w, h });
		}
	});

	it('points at files that exist', () => {
		const shots = (manifest().screenshots ?? []) as { src: string }[];
		for (const s of shots) expect(existsSync(at(`static${s.src}`))).toBe(true);
	});

	it('has an apple-touch-icon at the 180px Safari expects', () => {
		expect(png_size('static/icons/apple-touch-icon.png')).toEqual({ w: 180, h: 180 });
	});
});
