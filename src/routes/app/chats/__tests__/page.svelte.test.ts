// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';

const { goto } = vi.hoisted(() => ({ goto: vi.fn() }));
const { wsOnMock, wsSendMock, wsDropMock } = vi.hoisted(() => ({
	wsOnMock: vi.fn(),
	wsSendMock: vi.fn(),
	wsDropMock: vi.fn()
}));

vi.mock('$app/navigation', () => ({ goto }));
vi.mock('$lib/ws', () => ({ ws_on: wsOnMock, ws_send: wsSendMock, ws_drop: wsDropMock }));

import Page from '../+page.svelte';
import type { PageData } from '../$types';

const base: PageData = {
	user: { id: 'me', username: 'me' },
	convs: [],
	folders: [],
	unread: {},
	hub_error: null
};

beforeEach(() => {
	vi.clearAllMocks();
	wsOnMock.mockReturnValue(() => {});
	globalThis.fetch = vi.fn();
});

describe('GET /app/chats page render states', () => {
	it('renders the unavailable banner when the hub read failed, not the empty state', () => {
		render(Page, { props: { data: { ...base, hub_error: 'network' } } });
		expect(screen.getByText(/chats unavailable/)).toBeInTheDocument();
		expect(screen.queryByText(/no conversations yet/)).not.toBeInTheDocument();
	});

	it('renders the friendly empty state when the hub is healthy but has no convs', () => {
		render(Page, { props: { data: { ...base, hub_error: null } } });
		expect(screen.getByText(/no conversations yet/)).toBeInTheDocument();
	});

	it('renders conversation rows when convs exist', () => {
		render(Page, {
			props: {
				data: {
					...base,
					convs: [{ peer: 'bob', last: 1, preview: 'hey', name: 'Bobby', muted: false, unread: 0 }]
				}
			}
		});
		expect(screen.getAllByText('Bobby').length).toBeGreaterThan(0);
		expect(screen.getByText('hey')).toBeInTheDocument();
	});
});
