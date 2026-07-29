import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(resolve('src/app.css'), 'utf-8');

describe('app.css structure', () => {
	it('wraps every media-query rule in @layer components', () => {
		const blocks = css.match(/@media\s*\([^)]+\)\s*\{[^}]+\}/g) ?? [];
		for (const block of css.match(/@media[^{]*\{[\s\S]*?\n\}/g) ?? []) {
			if (!block.includes('@layer components')) {
				expect(block).toMatch(/@layer components/);
			}
		}
		// ensure we found at least one media query
		expect(blocks.length).toBeGreaterThan(0);
	});

	it('defines the --chrome custom property for both breakpoints', () => {
		expect(css).toMatch(/:root[\s\S]*?--chrome\s*:\s*110px/);
		expect(css).toMatch(/@media\s*\(max-width:\s*640px\)[\s\S]*?--chrome\s*:\s*calc/);
	});

	it('defines .btn-ghost', () => {
		expect(css).toMatch(/\.btn-ghost/);
	});
});
