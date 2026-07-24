import { defineConfig } from 'vitest/config';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
	server: {
		port: 7227
	},
	plugins: [tailwindcss(), sveltekit()],
	test: {
		environment: 'node',
		include: ['src/**/*.{test,spec}.ts', 'ws/**/*.{test,spec}.ts']
	}
});
