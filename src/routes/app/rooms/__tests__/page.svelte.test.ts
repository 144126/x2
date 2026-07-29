// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$lib/components/Modal.svelte', () => ({ default: () => {} }));
vi.mock('$lib/components/FolderBar.svelte', () => ({ default: () => {} }));
vi.mock('$lib/LocationPicker.svelte', () => ({ default: () => {} }));
vi.mock('@lucide/svelte', () => ({
	Search: () => {},
	Plus: () => {},
	Users: () => {},
	SlidersHorizontal: () => {}
}));

import Page from '../+page.svelte';

const baseMine = [
	{ id: 'g1', name: 'Room 1', description: 'desc', owner: 'me', members: ['me'], created: 1 }
];

function data(over: Record<string, unknown> = {}) {
	return { mine: baseMine, folders: [], user: { id: 'me', username: 'me' }, ...over };
}

beforeEach(() => {
	vi.clearAllMocks();
	globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ r: [] }) });
});

describe('/app/rooms page', () => {
	it('shows the location under a room name when set', () => {
		const mine = [
			{
				...baseMine[0],
				country: 'US',
				state: 'CA',
				city: 'SF'
			}
		];
		render(Page, { props: { data: data({ mine }) } });
		expect(screen.getByText(/SF/)).toBeInTheDocument();
	});

	it('shows no location line for a room without one', () => {
		render(Page, { props: { data: data() } });
		expect(screen.queryByText(/·/)).toBeNull();
	});

	it('filters joined rooms down to rooms you created when the toggle is checked', async () => {
		const { fireEvent } = await import('@testing-library/svelte');
		const mine = [
			{ ...baseMine[0], id: 'g1', name: 'Mine', owner: 'me' },
			{ ...baseMine[0], id: 'g2', name: 'Theirs', owner: 'someone-else' }
		];
		render(Page, { props: { data: data({ mine }) } });
		expect(screen.getByText('Mine')).toBeInTheDocument();
		expect(screen.getByText('Theirs')).toBeInTheDocument();

		await fireEvent.click(screen.getByLabelText('rooms you created'));

		expect(screen.getByText('Mine')).toBeInTheDocument();
		expect(screen.queryByText('Theirs')).toBeNull();
	});
});
