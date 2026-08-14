// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import Page from '../+page.svelte';

describe('/ (voice match home)', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it('leads with the one button that starts a match', () => {
		render(Page, { props: { data: { user: null } } });
		expect(screen.getByRole('button', { name: /start talking/ })).toBeInTheDocument();
		expect(screen.getByText(/who gets it/)).toBeInTheDocument();
	});

	it('offers two doors under the voice match, rooms first', () => {
		render(Page, { props: { data: { user: null } } });
		const doors = screen.getAllByRole('link');
		const hrefs = doors.map((a) => a.getAttribute('href'));
		expect(hrefs.indexOf('/rooms')).toBeGreaterThan(-1);
		expect(hrefs.indexOf('/find')).toBeGreaterThan(hrefs.indexOf('/rooms'));
	});

	it('tells a stranger the rooms door needs no account, which is the whole offer', () => {
		render(Page, { props: { data: { user: null } } });
		expect(screen.getByText(/without an account/)).toBeInTheDocument();
	});

	it('mints a session and opens the lobby socket when you press start', async () => {
		const sockets: string[] = [];
		vi.stubGlobal(
			'WebSocket',
			class {
				onmessage: unknown;
				onclose: unknown;
				onerror: unknown;
				constructor(url: string) {
					sockets.push(url);
				}
				send() {}
				close() {}
			}
		);
		const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
			Response.json({ uid: 'me', match: 'ws://x/match?uid=me&t=a&exp=1' })
		);
		vi.stubGlobal('fetch', fetchMock);

		render(Page, { props: { data: { user: { id: 'me', username: 'me' } } } });
		await fireEvent.click(screen.getByRole('button', { name: /start talking/ }));
		// the signalling socket opens alongside the lobby one, so match on the lobby url
		await vi.waitFor(() => expect(sockets).toContain('ws://x/match?uid=me&t=a&exp=1'));

		expect(fetchMock.mock.calls[0][0]).toBe('/api/wstoken');
		expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST' });
		expect(screen.getByText(/finding someone/)).toBeInTheDocument();
	});

	it('says the matching service failed instead of hanging on the spinner', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('no', { status: 503 }))
		);
		render(Page, { props: { data: { user: { id: 'me', username: 'me' } } } });
		await fireEvent.click(screen.getByRole('button', { name: /start talking/ }));
		await vi.waitFor(() =>
			expect(screen.getByText(/could not reach the matching service/)).toBeInTheDocument()
		);
	});
});
