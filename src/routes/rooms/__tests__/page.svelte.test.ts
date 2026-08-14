// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';

const { goto, pushState } = vi.hoisted(() => ({ goto: vi.fn(), pushState: vi.fn() }));
const { pageStore } = vi.hoisted(() => {
	let value = { state: {} };
	const subs = new Set<(v: unknown) => void>();
	return {
		pageStore: {
			subscribe(fn: (v: unknown) => void) {
				fn(value);
				subs.add(fn);
				return () => subs.delete(fn);
			},
			set(v: unknown) {
				value = v as never;
				subs.forEach((f) => f(value));
			}
		}
	};
});
vi.mock('$app/navigation', () => ({ goto, pushState }));
vi.mock('$app/stores', () => ({ page: pageStore }));
vi.mock('$lib/components/FolderBar.svelte', () => ({ default: () => {} }));
vi.mock('$lib/LocationPicker.svelte', () => ({ default: () => {} }));
vi.mock('@lucide/svelte', () => ({
	Search: () => {},
	Plus: () => {},
	Users: () => {},
	SlidersHorizontal: () => {},
	Check: () => {},
	X: () => {}
}));

import Page from '../+page.svelte';

const baseMine = [
	{
		id: 'g1',
		name: 'Room 1',
		description: 'desc',
		owner: 'me',
		roomState: 'a' as const,
		members: ['me'],
		created: 1
	}
];

function data(over: Record<string, unknown> = {}) {
	return { mine: baseMine, folders: [], user: { id: 'me', username: 'me' }, ...over };
}

beforeEach(() => {
	vi.clearAllMocks();
	pageStore.set({ state: {} });
	globalThis.fetch = vi
		.fn()
		.mockResolvedValue({ ok: true, json: () => Promise.resolve({ r: [] }) });
});

describe('/rooms page', () => {
	it('carries the final rooms-page copy', () => {
		render(Page, { props: { data: data({ mine: [] }) } });
		expect(screen.getByText('your rooms')).toBeInTheDocument();
		expect(screen.getByText('yours')).toBeInTheDocument();
		expect(screen.getByText('nothing yet — search above, or start your own.')).toBeInTheDocument();
	});

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

		await fireEvent.click(screen.getByRole('button', { name: 'rooms you created' }));

		expect(screen.getByText('Mine')).toBeInTheDocument();
		expect(screen.queryByText('Theirs')).toBeNull();
	});

	it('adds and removes tags as tokens and sends them on create', async () => {
		const { fireEvent } = await import('@testing-library/svelte');
		const mockFetch = vi
			.fn()
			.mockResolvedValue({ ok: true, json: () => Promise.resolve({ g: { id: 'g1' } }) });
		globalThis.fetch = mockFetch;

		render(Page, { props: { data: data() } });

		await fireEvent.input(screen.getByPlaceholderText('room name'), {
			target: { value: 'Chess Club' }
		});

		const tagInput = screen.getByPlaceholderText('add a tag…');
		await fireEvent.input(tagInput, { target: { value: 'coffee' } });
		await fireEvent.keyDown(tagInput, { key: 'Enter' });
		expect(screen.getByText('coffee')).toBeInTheDocument();

		await fireEvent.input(tagInput, { target: { value: 'chess' } });
		await fireEvent.keyDown(tagInput, { key: 'Enter' });
		expect(screen.getByText('chess')).toBeInTheDocument();

		await fireEvent.click(screen.getByLabelText('remove coffee'));
		expect(screen.queryByText('coffee')).toBeNull();

		await fireEvent.click(screen.getByRole('button', { name: 'create room', hidden: true }));

		expect(mockFetch).toHaveBeenCalledWith(
			'/api/groups',
			expect.objectContaining({
				method: 'POST',
				body: expect.stringContaining('"tags":["chess"]')
			})
		);
	});

	it('opens the create-room modal via pushState, not a local flag', async () => {
		const { fireEvent } = await import('@testing-library/svelte');
		render(Page, { props: { data: data() } });
		await fireEvent.click(screen.getByRole('button', { name: /start a room/ }));
		expect(pushState).toHaveBeenCalledWith('', { modal: 'create-room' });
	});

	it('closing the create-room modal calls history.back()', async () => {
		const { fireEvent, within } = await import('@testing-library/svelte');
		const backSpy = vi.spyOn(history, 'back').mockImplementation(() => {});
		pageStore.set({ state: { modal: 'create-room' } });
		render(Page, { props: { data: data() } });
		const dialog = screen
			.getAllByRole('dialog', { hidden: true })
			.find((d) => d.textContent?.includes('start a room'))!;
		await fireEvent.click(within(dialog).getByLabelText('close'));
		expect(backSpy).toHaveBeenCalled();
	});
});
