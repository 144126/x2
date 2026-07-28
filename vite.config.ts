import { defineConfig } from 'vitest/config';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
	server: {
		port: 7227
	},
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
