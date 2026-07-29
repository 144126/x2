// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';

const { push_state, enable_push, disable_push } = vi.hoisted(() => ({
	push_state: vi.fn(),
	enable_push: vi.fn(),
	disable_push: vi.fn()
}));
vi.mock('$lib/push-client', () => ({ push_state, enable_push, disable_push }));

vi.mock('$lib/LocationPicker.svelte', () => ({ default: () => {} }));
vi.mock('$lib/PhoneInput.svelte', () => ({ default: () => {} }));
vi.mock('$lib/components/Select.svelte', () => ({ default: () => {} }));

import Page from '../+page.svelte';

function mockRes(body: Record<string, unknown> = {}) {
	return { ok: true, json: () => Promise.resolve(body) };
}

const baseData = {
	user: { id: 'me', username: 'testuser' },
	p: {
		id: 'me',
		u: 'testuser',
		m: 'test@x.com',
		s: 'u',
		co: '',
		st: '',
		ci: '',
		ag: '',
		r: '',
		w: ''
	},
	partner_code: null,
	mutes: [] as { target: string; kind: 'u' | 'r'; until: number; name: string }[]
};

function data(over: Record<string, unknown> = {}) {
	return { ...baseData, ...over };
}

beforeEach(() => {
	vi.clearAllMocks();
	push_state.mockResolvedValue('off');
	enable_push.mockResolvedValue({ ok: true });
	disable_push.mockResolvedValue(true);
	globalThis.fetch = vi.fn((url: string) =>
		Promise.resolve(url === '/api/push' ? mockRes({ key: 'vapid-key' }) : mockRes({ balance: 0 }))
	);
	Object.defineProperty(navigator, 'serviceWorker', {
		value: { ready: Promise.resolve({}) },
		writable: true
	});
});

describe('profile view profile button', () => {
	it('links to the public profile view for the signed-in user id', async () => {
		render(Page, { props: { data: data({ p: { ...baseData.p, id: 'u1' } }) } });
		const link = screen.getByText('view profile');
		expect(link).toBeInTheDocument();
		expect(link).toHaveAttribute('href', '/app/user/u1');
	});
});

describe('profile notification settings', () => {
	it('lists every muted user and room', async () => {
		const mutes = [
			{ target: 'bob', kind: 'u' as const, until: 0, name: 'Bob' },
			{ target: 'g1', kind: 'r' as const, until: 0, name: 'Ceramics Crew' }
		];
		render(Page, { props: { data: data({ mutes }) } });
		expect(await screen.findByText('Bob')).toBeInTheDocument();
		expect(await screen.findByText('Ceramics Crew')).toBeInTheDocument();
	});

	it('shows an empty state when nothing is muted', () => {
		render(Page, { props: { data: data() } });
		expect(screen.getByText('nothing muted.')).toBeInTheDocument();
	});

	it('unmutes on click and removes the row', async () => {
		const mutes = [{ target: 'bob', kind: 'u' as const, until: 0, name: 'Bob' }];
		render(Page, { props: { data: data({ mutes }) } });
		expect(await screen.findByText('Bob')).toBeInTheDocument();
		await fireEvent.click(screen.getByLabelText('unmute Bob'));
		expect(globalThis.fetch).toHaveBeenCalledWith('/api/mute?target=bob', { method: 'DELETE' });
	});

	it('keeps the row when the unmute request fails', async () => {
		const mutes = [{ target: 'bob', kind: 'u' as const, until: 0, name: 'Bob' }];
		render(Page, { props: { data: data({ mutes }) } });
		expect(await screen.findByText('Bob')).toBeInTheDocument();
		const target = screen.getByLabelText('unmute Bob');
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: false });
		await fireEvent.click(target);
		expect(screen.getByText('Bob')).toBeInTheDocument();
	});

	it('still renders a mute whose target no longer exists', () => {
		const mutes = [{ target: 'deleted-user', kind: 'u' as const, until: 0, name: 'deleted-user' }];
		render(Page, { props: { data: data({ mutes }) } });
		expect(screen.getByText('deleted-user')).toBeInTheDocument();
	});

	it('shows the expiry for a temporary mute', () => {
		const until = Date.now() + 8 * 3600_000;
		const mutes = [{ target: 'bob', kind: 'u' as const, until, name: 'Bob' }];
		render(Page, { props: { data: data({ mutes }) } });
		expect(screen.getByText(/until/)).toBeInTheDocument();
	});

	it('shows no expiry for an indefinite mute', () => {
		const mutes = [{ target: 'bob', kind: 'u' as const, until: 0, name: 'Bob' }];
		render(Page, { props: { data: data({ mutes }) } });
		expect(screen.queryByText(/until/)).toBeNull();
	});

	it('fetches the vapid key from /api/push before enabling push', async () => {
		push_state.mockResolvedValue('off');
		render(Page, { props: { data: data() } });
		await screen.findByText('enable');
		fireEvent.click(screen.getByText('enable'));
		expect(globalThis.fetch).toHaveBeenCalledWith('/api/push');
		expect(enable_push).toHaveBeenCalledWith('vapid-key');
	});

	it('shows the push toggle after loading', async () => {
		push_state.mockResolvedValue('off');
		render(Page, { props: { data: data() } });
		expect(await screen.findByText('enable')).toBeInTheDocument();
	});

	it('enables push when the toggle is switched on', async () => {
		push_state.mockResolvedValue('off');
		render(Page, { props: { data: data() } });
		await fireEvent.click(await screen.findByText('enable'));
		expect(enable_push).toHaveBeenCalledWith('vapid-key');
	});

	it('disables push when the toggle is switched off', async () => {
		push_state.mockResolvedValue('on');
		render(Page, { props: { data: data() } });
		await fireEvent.click(await screen.findByText('disable'));
		expect(disable_push).toHaveBeenCalled();
	});

	it('explains rather than offering a toggle when push is blocked', async () => {
		push_state.mockResolvedValue('blocked');
		render(Page, { props: { data: data() } });
		expect(await screen.findByText(/notifications are blocked/i)).toBeInTheDocument();
	});

	it('explains rather than offering a toggle when push is unsupported', async () => {
		push_state.mockResolvedValue('unsupported');
		render(Page, { props: { data: data() } });
		expect(await screen.findByText(/notifications are not supported/i)).toBeInTheDocument();
	});
});
