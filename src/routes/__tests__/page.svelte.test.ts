// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import Page from '../+page.svelte';

const g = {
	id: 'g1',
	name: 'Chess Club',
	description: 'openings, endgames, and tournament recaps.',
	owner: 'bob',
	roomState: 'a' as const,
	members: ['me', 'bob'],
	created: 100
};

describe('/ (logged-out home)', () => {
	it('shows the room grid from load data', () => {
		render(Page, { props: { data: { user: null, rooms: [g] } } });
		expect(screen.getByRole('link', { name: 'Chess Club' })).toHaveAttribute('href', '/login');
		expect(screen.getByText(/openings, endgames/)).toBeInTheDocument();
		expect(screen.getByText('2 members')).toBeInTheDocument();
	});

	it('renders a search input bound to q', async () => {
		const { fireEvent } = await import('@testing-library/svelte');
		render(Page, { props: { data: { user: null, rooms: [] } } });
		const input = screen.getByPlaceholderText(/search rooms/);
		await fireEvent.input(input, { target: { value: 'chess' } });
		expect(input).toHaveValue('chess');
	});

	it('has every CTA pointing to /login', () => {
		render(Page, { props: { data: { user: null, rooms: [g] } } });
		const links = screen.getAllByRole('link');
		expect(links.length).toBeGreaterThan(0);
		for (const a of links) expect(a).toHaveAttribute('href', '/login');
	});
});
