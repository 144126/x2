// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/svelte';

const { goto, pushState } = vi.hoisted(() => ({ goto: vi.fn(), pushState: vi.fn() }));
const { pageStore } = vi.hoisted(() => {
	let value = { data: { user: { id: 'me' } }, state: {} };
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
vi.mock('$lib/ws', () => ({ ws_on: vi.fn(), ws_send: vi.fn() }));
vi.mock('$lib/attach', () => ({
	upload_image: vi.fn(),
	media_src: (k: string) => k,
	image_from_event: vi.fn()
}));
vi.mock('$lib/notify-trigger', () => ({ mark_first_send: vi.fn() }));

import type { GroupView } from '$lib/server/group';
import Page from '../+page.svelte';

const g = {
	id: 'g1',
	name: 'Ceramics Crew',
	description: 'wheel-thrown pots and glaze chat. everyone welcome.',
	owner: 'me',
	roomState: 'a',
	members: ['me', 'bob', 'carol'],
	created: 100,
	country: 'GH',
	state: 'AA',
	city: 'Accra'
};

const data = (over: Record<string, unknown> = {}) => ({
	user: { id: 'me', username: 'me' },
	g: { ...g, ...over } as GroupView,
	messages: [],
	names: { me: 'Me', bob: 'Bob', carol: 'Carol' },
	muted: false
});

beforeEach(() => {
	vi.clearAllMocks();
	pageStore.set({ data: { user: { id: 'me' } }, state: {} });
});

describe('room description modal', () => {
	function aboutDialog() {
		return screen
			.getAllByRole('dialog', { hidden: true })
			.find((d) => d.querySelector('h2')?.textContent === g.name)!;
	}

	function btn() {
		return screen.getByRole('button', { name: /Ceramics Crew/ });
	}

	function openModal() {
		return fireEvent.click(btn());
	}

	it('does not show the description in the page body', () => {
		render(Page, { props: { data: data() } });
		const dialog = aboutDialog();
		expect(dialog).toBeInTheDocument();
		expect(dialog).not.toBeVisible();
		expect(dialog).toHaveTextContent(/wheel-thrown pots/);
	});

	it('opens the description modal when the room name is clicked', async () => {
		render(Page, { props: { data: data() } });
		await openModal();
		expect(aboutDialog()).toBeVisible();
	});

	it('renders the room name as the modal title', async () => {
		render(Page, { props: { data: data() } });
		await openModal();
		expect(aboutDialog()).toHaveTextContent('Ceramics Crew');
	});

	it('shows the full, unclamped description in the modal', async () => {
		render(Page, { props: { data: data() } });
		await openModal();
		expect(screen.getByText(/wheel-thrown pots and glaze chat/)).toBeInTheDocument();
	});

	it('shows a placeholder for a room with no description', async () => {
		render(Page, { props: { data: data({ description: '' }) } });
		await openModal();
		expect(screen.getByText('no description yet.')).toBeInTheDocument();
	});

	it('shows the location in the modal when set', async () => {
		render(Page, { props: { data: data() } });
		await openModal();
		const dialog = aboutDialog();
		expect(dialog).toHaveTextContent(/Accra/);
		expect(dialog).toHaveTextContent(/AA/);
		expect(dialog).toHaveTextContent(/GH/);
	});

	it('shows the member count in the modal', async () => {
		render(Page, { props: { data: data() } });
		await openModal();
		expect(aboutDialog()).toHaveTextContent('3');
	});

	it('makes the room name a real button, not a clickable div', () => {
		render(Page, { props: { data: data() } });
		const el = btn();
		expect(el).toBeInTheDocument();
		expect(el.tagName).toBe('BUTTON');
	});

	it('keeps the owner edit form in its own modal, separate from the description modal', async () => {
		pageStore.set({ data: { user: { id: 'me' } }, state: { modal: 'edit-room' } });
		render(Page, { props: { data: data() } });
		// the edit modal is open, the description modal is not
		expect(aboutDialog().getAttribute('open')).toBeNull();
		expect(screen.getByDisplayValue('Ceramics Crew')).toBeInTheDocument();

		// open the description modal — must not contain the edit input
		await openModal();
		expect(aboutDialog()).toBeVisible();
		expect(within(aboutDialog()).queryByDisplayValue('Ceramics Crew')).toBeNull();
	});

	it('opens the edit-room modal via pushState, not a local flag', async () => {
		render(Page, { props: { data: data() } });
		await fireEvent.click(screen.getByRole('button', { name: 'edit' }));
		expect(pushState).toHaveBeenCalledWith('', { modal: 'edit-room' });
	});

	it('closing the edit-room modal calls history.back()', async () => {
		const backSpy = vi.spyOn(history, 'back').mockImplementation(() => {});
		pageStore.set({ data: { user: { id: 'me' } }, state: { modal: 'edit-room' } });
		render(Page, { props: { data: data() } });
		const dialog = screen
			.getAllByRole('dialog', { hidden: true })
			.find((d) => d.querySelector('h2')?.textContent === 'edit room')!;
		await fireEvent.click(within(dialog).getByLabelText('close'));
		expect(backSpy).toHaveBeenCalled();
	});

	it('shows a mute control for a member', async () => {
		render(Page, { props: { data: data() } });
		expect(screen.getByLabelText('mute notifications for this room')).toBeInTheDocument();
	});

	it('shows no mute control for a non-member', async () => {
		render(Page, { props: { data: data({ members: ['owner1', 'bob'] }) } });
		expect(screen.queryByLabelText(/mute/)).toBeNull();
	});

	it('lists every member in the modal, linked to their member page', async () => {
		render(Page, { props: { data: data() } });
		await openModal();
		const bob = screen.getByRole('link', { name: 'Bob' });
		expect(bob).toHaveAttribute('href', '/app/user/bob');
		const carol = screen.getByRole('link', { name: 'Carol' });
		expect(carol).toHaveAttribute('href', '/app/user/carol');
		const me = screen.getByRole('link', { name: 'Me' });
		expect(me).toHaveAttribute('href', '/app/user/me');
	});

	it('falls back to a placeholder for a member with no known name', async () => {
		render(Page, {
			props: {
				data: {
					user: { id: 'me', username: 'me' },
					g: { ...g } as GroupView,
					messages: [],
					names: { me: 'Me', bob: 'Bob' },
					muted: false
				}
			}
		});
		await openModal();
		expect(screen.getByText('someone')).toBeInTheDocument();
	});
});
