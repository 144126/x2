import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { writable } from 'svelte/store';

vi.mock('$app/stores', () => ({
	page: writable({ url: new URL('https://x/app') })
}));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

import Layout from '../+layout.svelte';

const fakeUser = { id: 'me', username: 'me' };

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
});
