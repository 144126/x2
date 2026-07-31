import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { writable } from 'svelte/store';
import type { Snippet } from 'svelte';

vi.mock('$app/stores', () => ({
	page: writable({ url: new URL('https://x/app') })
}));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

const { devEnv, registerMock } = vi.hoisted(() => ({
	devEnv: { value: true },
	registerMock: vi.fn()
}));

vi.mock('$app/environment', () => ({ get dev() { return devEnv.value; } }));

import Layout from '../+layout.svelte';

const fakeUser = { id: 'me', username: 'me' };

beforeEach(() => {
	vi.clearAllMocks();
	devEnv.value = true;
	Object.defineProperty(navigator, 'serviceWorker', {
		value: { register: registerMock },
		writable: true,
		configurable: true
	});
	registerMock.mockResolvedValue(undefined);
});

describe('service worker registration', () => {
	it('registers as a module in dev', () => {
		devEnv.value = true;
		render(Layout, { props: { data: { user: fakeUser }, children: () => '' } });
		expect(registerMock).toHaveBeenCalledWith('/service-worker.js', { type: 'module' });
	});

	it('registers as classic in production', () => {
		devEnv.value = false;
		render(Layout, { props: { data: { user: fakeUser }, children: () => '' } });
		expect(registerMock).toHaveBeenCalledWith('/service-worker.js', { type: 'classic' });
	});
});

describe('bottom nav', () => {
	it('renders four destinations for a signed-in user', () => {
		render(Layout, { props: { data: { user: fakeUser }, children: () => '' } });
		const links = screen.getAllByRole('link');
		const labels = links.map((l) => l.textContent?.toLowerCase().trim());
		expect(labels).toEqual(expect.arrayContaining(['people', 'chats', 'rooms', 'profile']));
	});

	it('renders no nav at all when signed out', () => {
		render(Layout, { props: { data: { user: null }, children: () => '' } });
		const links = screen.queryAllByRole('link');
		const navLabels = links.filter((l) =>
			['people', 'chats', 'rooms', 'profile'].includes(l.textContent?.toLowerCase().trim() ?? '')
		);
		expect(navLabels.length).toBe(0);
	});

	it('renders rooms as the first nav item', () => {
		render(Layout, {
			props: { data: { user: fakeUser }, children: (() => '') as unknown as Snippet }
		});
		const links = screen.getAllByRole('link').filter((l) => l.textContent?.toLowerCase().trim());
		const navLinks = links.filter((l) =>
			['people', 'chats', 'rooms', 'profile'].includes(l.textContent?.toLowerCase().trim() ?? '')
		);
		expect(navLinks[0]).toHaveTextContent('rooms');
		expect(navLinks[0]).toHaveAttribute('href', '/app/rooms');
	});

	it('logo links to /app/rooms', () => {
		render(Layout, {
			props: { data: { user: fakeUser }, children: (() => '') as unknown as Snippet }
		});
		const logo = screen.getByRole('link', { name: 'x2' });
		expect(logo).toHaveAttribute('href', '/app/rooms');
	});
});
