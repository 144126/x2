// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/svelte';

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
vi.mock('$lib/ws', () => ({ ws_on: vi.fn(), ws_send: vi.fn(), ws_drop: vi.fn() }));
vi.mock('$lib/attach', () => ({
	upload_file: vi.fn(),
	media_src: (k: string) => k,
	image_from_event: vi.fn()
}));
vi.mock('$lib/notify-trigger', () => ({ mark_first_send: vi.fn() }));
vi.mock('$lib/call', () => ({ CallMesh: class {} }));
vi.mock('$lib/components/RemoteVideo.svelte', () => ({
	default: { render: () => '' }
}));

import Page from '../+page.svelte';

const data = {
	peer: 'bob',
	peer_name: 'Bob',
	messages: [],
	muted: false
};

beforeEach(() => {
	vi.clearAllMocks();
});

describe('chat page layout', () => {
	it('sizes the thread against the --chrome custom property', () => {
		render(Page, { props: { data } });
		const section = document.querySelector('section');
		const cls = section?.className ?? '';
		expect(cls).toMatch(/h-\[calc\(100dvh-var\(--chrome\)\)\]/);
		expect(cls).not.toMatch(/140px/);
	});
});
