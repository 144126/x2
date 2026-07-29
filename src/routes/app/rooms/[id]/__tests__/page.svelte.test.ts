// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';

const { goto } = vi.hoisted(() => ({ goto: vi.fn() }));

vi.mock('$app/navigation', () => ({ goto }));
vi.mock('$app/stores', () => {
	const writable = <T>(v: T) => ({
		subscribe: (fn: (v: T) => void) => {
			fn(v);
			return () => {};
		}
	});
	return { page: writable({ data: { user: { id: 'me' } } }) };
});
vi.mock('$lib/ws', () => ({ ws_on: vi.fn(), ws_send: vi.fn() }));
vi.mock('$lib/attach', () => ({
	upload_image: vi.fn(),
	media_src: (k: string) => k,
	image_from_event: vi.fn()
}));
vi.mock('$lib/notify-trigger', () => ({ mark_first_send: vi.fn() }));

import Page from '../+page.svelte';

const g = {
	id: 'g1',
	name: 'Ceramics Crew',
	description: 'wheel-thrown pots and glaze chat. everyone welcome.',
	owner: 'me',
	members: ['me', 'bob', 'carol'],
	created: 100,
	country: 'GH',
	state: 'AA',
	city: 'Accra'
};

const data = (over: Record<string, unknown> = {}) => ({
	g: { ...g, ...over },
	messages: [],
	names: { me: 'Me', bob: 'Bob', carol: 'Carol' },
	muted: false
});

beforeEach(() => {
	vi.clearAllMocks();
});

describe('room description modal', () => {
	function aboutDialog() {
		return screen
			.getAllByRole('dialog', { hidden: true })
			.find((d) => d.textContent?.includes(g.name))!;
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

	it('keeps the owner edit form separate from the description modal', async () => {
		render(Page, { props: { data: data() } });
		// click edit — opens the form, not the modal
		await fireEvent.click(screen.getByRole('button', { name: 'edit' }));
		expect(aboutDialog().getAttribute('open')).toBeNull();
		expect(screen.getByDisplayValue('Ceramics Crew')).toBeInTheDocument();

		// close the form, open the modal — must not contain the edit input
		await fireEvent.click(screen.getByRole('button', { name: 'close' }));
		await openModal();
		expect(aboutDialog()).toBeVisible();
		expect(screen.queryByDisplayValue('Ceramics Crew')).not.toBeInTheDocument();
	});

	it('shows a mute control for a member', async () => {
		render(Page, { props: { data: data() } });
		expect(screen.getByLabelText('mute notifications for this room')).toBeInTheDocument();
	});

	it('shows no mute control for a non-member', async () => {
		render(Page, { props: { data: data({ members: ['owner1', 'bob'] }) } });
		expect(screen.queryByLabelText(/mute/)).toBeNull();
	});

	it('sizes the thread against the --chrome custom property', () => {
		render(Page, { props: { data: data() } });
		const section = document.querySelector('section');
		const cls = section?.className ?? '';
		expect(cls).toMatch(/h-\[calc\(100dvh-var\(--chrome\)\)\]/);
		expect(cls).not.toMatch(/140px/);
	});
});
