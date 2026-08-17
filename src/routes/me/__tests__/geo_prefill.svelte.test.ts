// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';

const { push_state, enable_push, disable_push } = vi.hoisted(() => ({
	push_state: vi.fn(),
	enable_push: vi.fn(),
	disable_push: vi.fn()
}));
const { invalidateAll } = vi.hoisted(() => ({ invalidateAll: vi.fn() }));
vi.mock('$lib/push-client', () => ({ push_state, enable_push, disable_push }));
vi.mock('$app/navigation', () => ({ invalidateAll }));

vi.mock('$lib/LocationPicker.svelte', () => ({ default: () => {} }));
vi.mock('$lib/PhoneInput.svelte', () => ({ default: () => {} }));
vi.mock('$lib/components/Select.svelte', () => ({ default: () => {} }));

import Page from '../+page.svelte';

const GEO = {
	country: 'NG',
	region: 'FC',
	region_name: 'Abuja Federal Capital Territory',
	city: 'Abuja',
	tz: 'Africa/Lagos'
};

function data(p: Record<string, unknown>) {
	return {
		id: 'me',
		geo: GEO,
		user: { id: 'me', username: 'ada' },
		p: { id: 'me', u: 'ada', s: 'u', g: 'me', d: 1, ...p },
		partner_code: '',
		mutes: [],
		pin: { on: false, allowed: true, has_google: true, has_pw: false }
	} as unknown as Parameters<typeof Page>[1]['data'];
}

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
	Object.defineProperty(navigator, 'serviceWorker', {
		value: { ready: Promise.resolve({}) },
		writable: true
	});
});

// a tag saves at once, so it is the cheapest way to make the page post its whole card
async function save() {
	const box = screen.getByLabelText('interests');
	await fireEvent.input(box, { target: { value: 'chess' } });
	await fireEvent.keyDown(box, { key: 'Enter' });
	await waitFor(() => expect(posted).not.toBeNull());
	return posted as Record<string, unknown>;
}

describe('ip-geo prefill', () => {
	it('fills the location of a user who has never set one', async () => {
		render(Page, { props: { data: data({}) } });
		const body = await save();
		expect(body.country).toBe('NG');
		expect(body.state).toBe('FC');
		expect(body.city).toBe('Abuja');
	});

	it('leaves a deliberately cleared location cleared', async () => {
		render(Page, { props: { data: data({ co: '', st: '', ci: '' }) } });
		const body = await save();
		expect(body.country).toBe('');
		expect(body.state).toBe('');
		expect(body.city).toBe('');
	});

	it('never overwrites a location the user chose', async () => {
		render(Page, { props: { data: data({ co: 'GH', st: 'AF', ci: 'Goaso' }) } });
		const body = await save();
		expect(body.country).toBe('GH');
		expect(body.state).toBe('AF');
		expect(body.city).toBe('Goaso');
	});

	it('fills each field on its own, so a cleared country cannot revive a cleared state', async () => {
		render(Page, { props: { data: data({ co: '' }) } });
		const body = await save();
		expect(body.country).toBe('');
		expect(body.state).toBe('FC');
	});

	it('sends empty strings when there is no ip guess at all', async () => {
		render(Page, {
			props: { data: { ...data({}), geo: null } as unknown as Parameters<typeof Page>[1]['data'] }
		});
		const body = await save();
		expect(body.country).toBe('');
		expect(body.state).toBe('');
	});
});
