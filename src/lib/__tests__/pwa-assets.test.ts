import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../../..');
const at = (p: string) => resolve(root, p);
const read = (p: string) => readFileSync(at(p), 'utf8');

const manifest = () => JSON.parse(read('static/manifest.webmanifest'));

/** width/height straight out of the PNG IHDR chunk */
function png_size(p: string): { w: number; h: number } {
	const b = readFileSync(at(p));
	expect([...b.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]); // PNG signature
	return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

describe('manifest — identity', () => {
	it('exists where the head links it', () => {
		expect(existsSync(at('static/manifest.webmanifest'))).toBe(true);
	});

	it('is valid JSON', () => {
		expect(() => manifest()).not.toThrow();
	});

	it('declares a stable id, so changing start_url never forks the install', () => {
		expect(manifest().id).toBeTruthy();
	});

	it('has a name and a short_name that fits under a home-screen icon', () => {
		const m = manifest();
		expect(m.name).toBeTruthy();
		expect(m.short_name.length).toBeLessThanOrEqual(12);
	});

	it('describes itself for the install dialog', () => {
		expect(manifest().description.length).toBeGreaterThan(10);
	});

	it('declares language and direction', () => {
		expect(manifest().lang).toBe('en');
		expect(manifest().dir).toBe('ltr');
	});

	it('is categorised as a social/communication app', () => {
		expect(manifest().categories).toContain('social');
	});
});

describe('manifest — launch', () => {
	it('opens into the app, not the marketing page', () => {
		expect(manifest().start_url.startsWith('/app')).toBe(true);
	});

	it('scopes the whole origin so auth redirects stay in the app window', () => {
		expect(manifest().scope).toBe('/');
	});

	it('runs standalone — that is what makes iOS grant push', () => {
		expect(manifest().display).toBe('standalone');
	});

	it('lists display fallbacks for browsers that do not honour standalone', () => {
		const d = manifest().display_override;
		expect(Array.isArray(d)).toBe(true);
		expect(d).toContain('standalone');
	});

	it('reuses an open window instead of stacking new ones', () => {
		expect(manifest().launch_handler.client_mode).toBe('navigate-existing');
	});

	it('paints the OS chrome in the app’s own colours', () => {
		expect(manifest().theme_color).toBe('#0b0b0c');
		expect(manifest().background_color).toBe('#0b0b0c');
	});

	it('does not defer to a native app that does not exist', () => {
		expect(manifest().prefer_related_applications ?? false).toBe(false);
	});
});

describe('manifest — icons', () => {
	const icons = () => manifest().icons as { src: string; sizes: string; type: string; purpose?: string }[];

	it('ships the 192 and 512 PNGs installability requires', () => {
		const any = icons().filter((i) => (i.purpose ?? 'any').includes('any'));
		expect(any.map((i) => i.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
	});

	it('ships maskable icons so Android does not letterbox the logo', () => {
		const maskable = icons().filter((i) => i.purpose?.includes('maskable'));
		expect(maskable.map((i) => i.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
	});

	it('ships a monochrome badge for the Android status bar', () => {
		expect(icons().some((i) => i.purpose?.includes('monochrome'))).toBe(true);
	});

	it('declares every icon as a PNG — Chrome will not render SVG in a notification', () => {
		for (const i of icons()) expect(i.type).toBe('image/png');
	});

	it('points at files that actually exist', () => {
		for (const i of icons()) expect(existsSync(at(`static${i.src}`))).toBe(true);
	});

	it('declares sizes that match the real pixel dimensions', () => {
		for (const i of icons()) {
			const [w, h] = i.sizes.split('x').map(Number);
			expect(png_size(`static${i.src}`)).toEqual({ w, h });
		}
	});
});

describe('manifest — screenshots', () => {
	const shots = () => (manifest().screenshots ?? []) as { src: string; form_factor?: string }[];

	it('includes a wide and a narrow shot, which Chrome requires for the rich install UI', () => {
		expect(shots().some((s) => s.form_factor === 'wide')).toBe(true);
		expect(shots().some((s) => s.form_factor === 'narrow')).toBe(true);
	});

	it('points at files that exist', () => {
		for (const s of shots()) expect(existsSync(at(`static${s.src}`))).toBe(true);
	});
});

describe('manifest — shortcuts', () => {
	const cuts = () => (manifest().shortcuts ?? []) as { name: string; url: string }[];

	it('offers long-press jumps into the main sections', () => {
		expect(cuts().map((c) => c.url)).toEqual(
			expect.arrayContaining(['/app', '/app/rooms'])
		);
	});

	it('names every shortcut', () => {
		for (const c of cuts()) expect(c.name).toBeTruthy();
	});
});

describe('manifest — share target', () => {
	const share = () => manifest().share_target;

	it('accepts content shared from the OS', () => {
		expect(share().action).toBe('/app/share');
		expect(share().method).toBe('POST');
	});

	it('uses multipart, the only encoding that can carry a shared file', () => {
		expect(share().enctype).toBe('multipart/form-data');
	});

	it('accepts shared text and images', () => {
		expect(share().params.text).toBeTruthy();
		expect(share().params.files[0].accept).toContain('image/*');
	});
});

describe('app.html head', () => {
	const html = () => read('src/app.html');

	it('links the manifest', () => {
		expect(html()).toMatch(/<link[^>]+rel="manifest"[^>]+href="\/manifest\.webmanifest"/);
	});

	it('opts into viewport-fit=cover — without it env(safe-area-inset-*) is always 0', () => {
		expect(html()).toMatch(/name="viewport"[^>]*viewport-fit=cover/);
	});

	it('sets a theme colour matching the manifest', () => {
		expect(html()).toMatch(/<meta[^>]+name="theme-color"[^>]+content="#0b0b0c"/);
	});

	it('declares the app dark, so form controls and scrollbars match', () => {
		expect(html()).toMatch(/name="color-scheme"[^>]+content="dark"/);
	});

	it('gives iOS a PNG touch icon — Safari will not take the SVG', () => {
		expect(html()).toMatch(/rel="apple-touch-icon"[^>]+href="\/icons\/apple-touch-icon\.png"/);
	});

	it('asks iOS and Android to run it as an app', () => {
		expect(html()).toMatch(/name="apple-mobile-web-app-capable"[^>]+content="yes"/);
		expect(html()).toMatch(/name="mobile-web-app-capable"[^>]+content="yes"/);
	});

	it('styles the iOS status bar for a dark app', () => {
		expect(html()).toMatch(/name="apple-mobile-web-app-status-bar-style"/);
	});

	it('names the app on the iOS home screen', () => {
		expect(html()).toMatch(/name="apple-mobile-web-app-title"/);
	});
});

describe('shell files', () => {
	it('has a service worker in the slot SvelteKit compiles', () => {
		expect(existsSync(at('src/service-worker.ts'))).toBe(true);
	});

	it('has an offline fallback page for navigations that miss the network', () => {
		expect(existsSync(at('src/routes/offline/+page.svelte'))).toBe(true);
	});

	it('has an apple-touch-icon at the 180px Safari expects', () => {
		expect(png_size('static/icons/apple-touch-icon.png')).toEqual({ w: 180, h: 180 });
	});

	it('keeps the SVG the icons are generated from', () => {
		expect(existsSync(at('static/logo.svg'))).toBe(true);
	});
});
