// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';

const { goto } = vi.hoisted(() => ({ goto: vi.fn() }));
const { wsOnMock, wsSendMock, wsDropMock } = vi.hoisted(() => ({
	wsOnMock: vi.fn(),
	wsSendMock: vi.fn(),
	wsDropMock: vi.fn()
}));
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

vi.mock('$app/navigation', () => ({ goto }));
vi.mock('$app/stores', () => ({ page: pageStore }));
vi.mock('$lib/ws', () => ({ ws_on: wsOnMock, ws_send: wsSendMock, ws_drop: wsDropMock }));
vi.mock('$lib/attach', () => ({
	upload_file: vi.fn(),
	media_src: (k: string) => k,
	image_from_event: vi.fn()
}));
vi.mock('$lib/notify-trigger', () => ({ mark_first_send: vi.fn() }));
vi.mock('$lib/chat_optimistic', () => ({
	confirm_sent: (m: unknown[]) => m,
	mark_failed: (m: unknown[]) => m
}));

import type { Message } from '$lib/types';
import Page from '../+page.svelte';

const data = {
	user: { id: 'me', username: 'me' },
	peer: 'bob',
	peer_name: 'Bob',
	conv: 'me|bob',
	messages: [] as unknown[],
	muted: false
};

beforeEach(() => {
	vi.clearAllMocks();
	pageStore.set({ data: { user: { id: 'me' } }, state: {} });
	Element.prototype.scrollTo = vi.fn();
});

describe('replying', () => {
	function renderWith(messages: Record<string, unknown>[]) {
		render(Page, { props: { data: { ...data, messages: messages as unknown as Message[] } } });
	}

	it('clicking reply on a message shows the quote-preview strip', async () => {
		renderWith([
			{ id: 'm1', f: 'bob', x: 'original text', d: 100 }
		]);
		await fireEvent.click(screen.getByRole('button', { name: 'reply' }));
		const strip = screen.getByLabelText('cancel reply').parentElement!;
		expect(strip).toHaveTextContent('original text');
	});

	it('sending while replying includes reply_to in the POST body, then clears the reply state', async () => {
		const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ m: null }) });
		globalThis.fetch = mockFetch;
		renderWith([
			{ id: 'm1', f: 'bob', x: 'original text', d: 100 }
		]);
		await fireEvent.click(screen.getByRole('button', { name: 'reply' }));
		const input = screen.getByPlaceholderText('write something considered…');
		await fireEvent.input(input, { target: { value: 'my reply' } });
		await fireEvent.submit(input.closest('form')!);
		expect(mockFetch).toHaveBeenCalledWith('/api/send', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ to: 'bob', text: 'my reply', reply_to: 'm1' })
		});
		expect(screen.queryByLabelText('cancel reply')).toBeNull();
	});

	it('cancel button clears the reply-preview strip without sending', async () => {
		const mockFetch = vi.fn();
		globalThis.fetch = mockFetch;
		renderWith([
			{ id: 'm1', f: 'bob', x: 'original text', d: 100 }
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
			{ id: 'm1', f: 'bob', x: 'replying', d: 100, rp: 'orig-1' }
		]);
		await vi.waitFor(() =>
			expect(mockFetch).toHaveBeenCalledWith('/api/messages/orig-1')
		);
		await vi.waitFor(() => expect(screen.getByText('quoted old text')).toBeInTheDocument());
	});
});

describe('reactions', () => {
	function renderWith(messages: Record<string, unknown>[]) {
		render(Page, { props: { data: { ...data, messages: messages as unknown as Message[] } } });
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
		renderWith([{ id: 'm1', f: 'bob', x: 'hi', d: 100 }]);
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
		renderWith([{ id: 'm1', f: 'bob', x: 'hi', d: 100, rx: { '👍': ['me', 'bob'] } }]);
		await fireEvent.click(screen.getByText('👍 2'));
		expect(mockFetch).toHaveBeenCalledWith('/api/messages/m1/react', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ emoji: '👍' })
		});
	});

	it('an incoming ws reaction message updates the thread live', async () => {
		renderWith([{ id: 'm1', f: 'bob', x: 'hi', d: 100 }]);
		lastWsHandler()({ type: 'reaction', id: 'm1', rx: { '❤️': ['bob'] } });
		await vi.waitFor(() => expect(screen.getByText('❤️ 1')).toBeInTheDocument());
	});

	it('an incoming ws edit message updates the text live', async () => {
		renderWith([{ id: 'm1', f: 'bob', x: 'old', d: 100 }]);
		lastWsHandler()({ type: 'edit', id: 'm1', text: 'edited!', ts: 200 });
		await vi.waitFor(() => expect(screen.getByText('edited!')).toBeInTheDocument());
	});

	it('an incoming ws delete message removes the message live', async () => {
		renderWith([{ id: 'm1', f: 'bob', x: 'old', d: 100 }]);
		lastWsHandler()({ type: 'delete', id: 'm1' });
		await vi.waitFor(() => expect(screen.queryByText('old')).toBeNull());
	});
});
