// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { writable } from 'svelte/store';

vi.mock('$app/stores', () => ({
	page: writable({ url: new URL('https://x/app') })
}));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$lib/LocationPicker.svelte', () => ({ default: () => {} }));
vi.mock('$lib/components/Select.svelte', () => ({ default: () => {} }));

import Page from '../+page.svelte';

beforeEach(() => {
	vi.restoreAllMocks();
	globalThis.fetch = vi
		.fn()
		.mockResolvedValue({ ok: true, json: () => Promise.resolve({ r: [] }) });
});

describe('search page filters modal', () => {
	it('carries the secondary match page copy', () => {
		render(Page, { props: { data: { user: { id: 'me', username: 'me' } } } });
		expect(screen.getByText('or match one-to-one')).toBeInTheDocument();
	});

	it('hides the filter controls until the filter button is clicked', () => {
		render(Page, { props: { data: { user: { id: 'me', username: 'me' } } } });
		const modal = screen.queryByRole('dialog');
		expect(modal).not.toBeInTheDocument();
	});

	it('shows no badge when no filter is set', () => {
		render(Page, { props: { data: { user: { id: 'me', username: 'me' } } } });
		const badge = screen.queryByText(/^[0-9]+$/);
		expect(badge).not.toBeInTheDocument();
	});

	it('closes the modal and runs the search on apply', async () => {
		render(Page, { props: { data: { user: { id: 'me', username: 'me' } } } });
		await fireEvent.click(screen.getByTitle('filters'));
		await fireEvent.click(screen.getByText('apply'));
		const modal = screen.queryByRole('dialog');
		expect(modal).not.toBeInTheDocument();
		expect(globalThis.fetch).toHaveBeenCalled();
	});
});
