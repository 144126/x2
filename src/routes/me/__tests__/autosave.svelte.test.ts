// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';

const { push_state, enable_push, disable_push } = vi.hoisted(() => ({
	push_state: vi.fn(),
	enable_push: vi.fn(),
	disable_push: vi.fn()
}));
vi.mock('$lib/push-client', () => ({ push_state, enable_push, disable_push }));
vi.mock('$app/navigation', () => ({ invalidateAll: vi.fn() }));
vi.mock('$lib/LocationPicker.svelte', () => ({ default: () => {} }));
vi.mock('$lib/PhoneInput.svelte', () => ({ default: () => {} }));
vi.mock('$lib/components/Select.svelte', () => ({ default: () => {} }));

import Page from '../+page.svelte';

const DELAY = 2160;

const data = {
	id: 'me',
	geo: null,
	user: { id: 'me', username: 'ada' },
	p: { id: 'me', u: 'ada', s: 'u', g: 'me', d: 1 },
	partner_code: '',
	mutes: [],
	pin: { on: false, allowed: true, has_google: true, has_pw: false }
} as unknown as Parameters<typeof Page>[1]['data'];

let posted: Record<string, unknown> | null;

beforeEach(() => {
	vi.clearAllMocks();
	posted = null;
	push_state.mockResolvedValue('off');
	globalThis.fetch = vi.fn((url: string, init?: RequestInit) => {
		if (url === '/api/profile' && init?.method === 'POST') posted = JSON.parse(init.body as string);
		return Promise.resolve({
			ok: true,
			json: () => Promise.resolve(url === '/api/push' ? { key: 'k' } : { balance: 0 })
		});
	}) as unknown as typeof fetch;
	vi.useFakeTimers();
});

afterEach(() => vi.useRealTimers());

async function type(label: string, value: string) {
	await fireEvent.input(screen.getByLabelText(label), { target: { value } });
}

describe('profile autosave', () => {
	it('does not save just because the page opened', async () => {
		render(Page, { props: { data } });
		await vi.advanceTimersByTimeAsync(DELAY * 2);
		expect(posted).toBeNull();
	});

	it('saves typed text once the typing stops, and not before', async () => {
		render(Page, { props: { data } });
		await type('username', 'ada2');
		await vi.advanceTimersByTimeAsync(DELAY - 1);
		expect(posted).toBeNull();
		await vi.advanceTimersByTimeAsync(2);
		expect(posted?.username).toBe('ada2');
	});

	it('restarts the wait on every keystroke, so it saves once, not per letter', async () => {
		render(Page, { props: { data } });
		await type('username', 'ad');
		await vi.advanceTimersByTimeAsync(DELAY - 1);
		await type('username', 'ada');
		await vi.advanceTimersByTimeAsync(DELAY - 1);
		expect(posted).toBeNull();
		await vi.advanceTimersByTimeAsync(2);
		expect(posted?.username).toBe('ada');
	});

	it('saves a tag the moment it is added, without the wait', async () => {
		render(Page, { props: { data } });
		const box = screen.getByLabelText('interests');
		await fireEvent.input(box, { target: { value: 'chess' } });
		await fireEvent.keyDown(box, { key: 'Enter' });
		await vi.advanceTimersByTimeAsync(0);
		expect(posted?.interests).toEqual(['chess']);
	});

	it('saves a tag the moment it is removed', async () => {
		render(Page, { props: { data: { ...data, p: { ...data.p, i: ['chess'] } } } });
		await fireEvent.click(screen.getByLabelText('remove chess'));
		await vi.advanceTimersByTimeAsync(0);
		expect(posted?.interests).toEqual([]);
	});
});
