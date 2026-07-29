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
	return { mine: baseMine, folders: [], ...over };
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
});
