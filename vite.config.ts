import { defineConfig } from 'vitest/config';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
	server: {
		port: 7227
	},
	// @lucide/svelte ships raw .svelte source even in its "compiled" JS barrel (Svelte
	// components can't be pre-compiled framework-agnostically) — without this, Vite's SSR
	// pipeline externalizes it as a plain Node import, and Node's ESM loader can't parse
	// .svelte files, 500ing every page that imports an icon.
	ssr: { noExternal: ['@lucide/svelte'] },
	plugins: [tailwindcss(), sveltekit()],
	test: {
		projects: [
			{
				extends: true,
				test: {
					name: 'node',
					environment: 'node',
					include: ['src/**/*.{test,spec}.ts', 'ws/**/*.{test,spec}.ts'],
					exclude: ['src/lib/components/**']
				}
			},
			{
				extends: true,
				resolve: {
					conditions: ['browser']
				},
				test: {
					name: 'component',
					environment: 'jsdom',
					include: ['src/lib/components/**/*.{test,spec}.ts'],
					setupFiles: ['./vitest-setup-client.ts']
				}
			}
		]
	}
});
