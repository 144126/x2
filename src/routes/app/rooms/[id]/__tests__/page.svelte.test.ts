// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/svelte';

const { goto, pushState } = vi.hoisted(() => ({ goto: vi.fn(), pushState: vi.fn() }));
const { wsOnMock, wsSendMock } = vi.hoisted(() => {
	const wsOnMock = vi.fn();
	const wsSendMock = vi.fn();
	return { wsOnMock, wsSendMock };
});
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
vi.mock('$lib/ws', () => ({ ws_on: wsOnMock, ws_send: wsSendMock }));
vi.mock('$lib/attach', () => ({
	upload_image: vi.fn(),
	media_src: (k: string) => k,
	image_from_event: vi.fn()
}));
vi.mock('$lib/notify-trigger', () => ({ mark_first_send: vi.fn() }));

import type { GroupView } from '$lib/server/group';
import type { Message } from '$lib/types';
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
	Element.prototype.scrollTo = vi.fn();
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

describe('replying', () => {
	function renderWith(messages: Message[]) {
		render(Page, {
			props: {
				data: {
					user: { id: 'me', username: 'me' },
					g: { ...g, members: ['me'] } as GroupView,
					messages,
					names: { me: 'Me', bob: 'Bob' },
					muted: false
				}
			}
		});
	}

	it('clicking reply on a message shows the quote-preview strip', async () => {
		renderWith([
			{ s: 'm', id: 'm1', c: 'g:g1', f: 'bob', t: '', gr: 'g1', x: 'original text', d: 100 }
		]);
		await fireEvent.click(screen.getByRole('button', { name: 'reply' }));
		const strip = screen.getByLabelText('cancel reply').parentElement!;
		expect(strip).toHaveTextContent('original text');
	});

	it('sending while replying includes reply_to in the POST body, then clears the reply state', async () => {
		const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ m: null }) });
		globalThis.fetch = mockFetch;
		renderWith([
			{ s: 'm', id: 'm1', c: 'g:g1', f: 'bob', t: '', gr: 'g1', x: 'original text', d: 100 }
		]);
		await fireEvent.click(screen.getByRole('button', { name: 'reply' }));
		const input = screen.getByPlaceholderText('say something to the room…');
		await fireEvent.input(input, { target: { value: 'my reply' } });
		await fireEvent.submit(input.closest('form')!);
		expect(mockFetch).toHaveBeenCalledWith('/api/send', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ group: 'g1', text: 'my reply', image: undefined, reply_to: 'm1' })
		});
		expect(screen.queryByLabelText('cancel reply')).toBeNull();
	});

	it('cancel button clears the reply-preview strip without sending', async () => {
		const mockFetch = vi.fn();
		globalThis.fetch = mockFetch;
		renderWith([
			{ s: 'm', id: 'm1', c: 'g:g1', f: 'bob', t: '', gr: 'g1', x: 'original text', d: 100 }
		]);
		await fireEvent.click(screen.getByRole('button', { name: 'reply' }));
		await fireEvent.click(screen.getByLabelText('cancel reply'));
		expect(screen.queryByLabelText('cancel reply')).toBeNull();
		expect(mockFetch).not.toHaveBeenCalled();
	});

	it('a message with rp set to an id not in the loaded window fetches it via /api/messages/[id]', async () => {
		const mockFetch = vi.fn((url: string) => {
			if (url === '/api/messages/orig-1') {
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve({ m: { id: 'orig-1', x: 'quoted old text' } })
				});
			}
			return Promise.resolve({ ok: true, json: () => Promise.resolve({ m: null }) });
		});
		globalThis.fetch = mockFetch as unknown as typeof fetch;
		renderWith([
			{ s: 'm', id: 'm1', c: 'g:g1', f: 'bob', t: '', gr: 'g1', x: 'replying', d: 100, rp: 'orig-1' }
		]);
		await vi.waitFor(() =>
			expect(mockFetch).toHaveBeenCalledWith('/api/messages/orig-1')
		);
		await vi.waitFor(() => expect(screen.getByText('quoted old text')).toBeInTheDocument());
	});
});

describe('reactions', () => {
	function renderWith(messages: Message[]) {
		render(Page, {
			props: {
				data: {
					user: { id: 'me', username: 'me' },
					g: { ...g, members: ['me'] } as GroupView,
					messages,
					names: { me: 'Me', bob: 'Bob' },
					muted: false
				}
			}
		});
	}

	function lastWsHandler() {
		return wsOnMock.mock.calls.at(-1)![0];
	}

	it('clicking react opens the emoji picker and selecting an emoji POSTs and updates the grouped display', async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ rx: { '👍️': ['me'] } })
		});
		globalThis.fetch = mockFetch;
		renderWith([{ s: 'm', id: 'm1', c: 'g:g1', f: 'bob', t: '', gr: 'g1', x: 'hi', d: 100 }]);
		await fireEvent.click(screen.getByRole('button', { name: 'react' }));
		const search = screen.getByPlaceholderText('search emoji…');
		await fireEvent.input(search, { target: { value: 'thumbs up' } });
		await fireEvent.click(screen.getByTitle('thumbs up'));
		expect(mockFetch).toHaveBeenCalledWith('/api/messages/m1/react', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ emoji: '👍️' })
		});
		await vi.waitFor(() => expect(screen.getByText('👍️ 1')).toBeInTheDocument());
	});

	it('clicking an existing reaction chip toggles it off', async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ rx: {} })
		});
		globalThis.fetch = mockFetch;
		renderWith([
			{ s: 'm', id: 'm1', c: 'g:g1', f: 'bob', t: '', gr: 'g1', x: 'hi', d: 100, rx: { '👍': ['me', 'bob'] } }
		]);
		await fireEvent.click(screen.getByText('👍 2'));
		expect(mockFetch).toHaveBeenCalledWith('/api/messages/m1/react', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ emoji: '👍' })
		});
	});

	it('an incoming ws reaction message updates the thread live', async () => {
		renderWith([{ s: 'm', id: 'm1', c: 'g:g1', f: 'bob', t: '', gr: 'g1', x: 'hi', d: 100 }]);
		lastWsHandler()({ type: 'reaction', id: 'm1', rx: { '❤️': ['bob'] } });
		await vi.waitFor(() => expect(screen.getByText('❤️ 1')).toBeInTheDocument());
	});

	it('an incoming ws edit message updates the text live', async () => {
		renderWith([{ s: 'm', id: 'm1', c: 'g:g1', f: 'bob', t: '', gr: 'g1', x: 'old', d: 100 }]);
		lastWsHandler()({ type: 'edit', id: 'm1', text: 'edited!', ts: 200 });
		await vi.waitFor(() => expect(screen.getByText('edited!')).toBeInTheDocument());
	});

	it('an incoming ws delete message removes the message live', async () => {
		renderWith([{ s: 'm', id: 'm1', c: 'g:g1', f: 'bob', t: '', gr: 'g1', x: 'old', d: 100 }]);
		lastWsHandler()({ type: 'delete', id: 'm1' });
		await vi.waitFor(() => expect(screen.queryByText('old')).toBeNull());
	});
});
