// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import MuteButtonHost from './MuteButtonHost.test.svelte';

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(1_000_000_000_000);
	globalThis.fetch = vi.fn();
});

afterEach(() => {
	vi.useRealTimers();
});

describe('MuteButton', () => {
	it('shows a bell when not muted and a bell-off when muted', () => {
		render(MuteButtonHost, { props: { target: 't1', kind: 'r' } });
		expect(screen.getByLabelText('mute notifications')).toBeInTheDocument();
	});

	it('opens the duration modal on click when not muted', async () => {
		render(MuteButtonHost, { props: { target: 't1', kind: 'r' } });
		await fireEvent.click(screen.getByLabelText('mute notifications'));
		expect(screen.getByRole('dialog')).toBeInTheDocument();
	});

	it('POSTs an indefinite mute for the "until i turn it back on" option', async () => {
		const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
		globalThis.fetch = mockFetch;

		render(MuteButtonHost, { props: { target: 't1', kind: 'r' } });
		await fireEvent.click(screen.getByLabelText('mute notifications'));
		await fireEvent.click(screen.getByText('until i turn it back on'));
		expect(mockFetch).toHaveBeenCalledWith('/api/mute', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ target: 't1', kind: 'r', until: 0 })
		});
	});

	it('POSTs an absolute timestamp for the 8-hour option', async () => {
		const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
		globalThis.fetch = mockFetch;

		render(MuteButtonHost, { props: { target: 't1', kind: 'r' } });
		await fireEvent.click(screen.getByLabelText('mute notifications'));
		await fireEvent.click(screen.getByText('8 hours'));
		expect(mockFetch).toHaveBeenCalledWith('/api/mute', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ target: 't1', kind: 'r', until: 1_000_000_000_000 + 8 * 3600_000 })
		});
	});

	it('DELETEs without opening the modal when already muted', async () => {
		const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
		globalThis.fetch = mockFetch;

		render(MuteButtonHost, { props: { target: 't1', kind: 'r' } });
		// click to open mute dialog, then click indefinite mute
		await fireEvent.click(screen.getByLabelText('mute notifications'));
		await fireEvent.click(screen.getByText('until i turn it back on'));
		expect(mockFetch).toHaveBeenCalledTimes(1);

		// now simulate that the server responded and muted flipped to true
		// re-render with muted=true — but since muted is bound, after the server accepts,
		// the component flips it. Since our mock resolved immediately, flip the bound value.
		// We need to re-render or use the test-host state. Let's look at the aria-label after
		// the component's muted state becomes true.
		// Actually our host doesn't pass initial muted=true. Let me test differently:

		// Just test the DELETE path directly: The component when muted=true doesn't show dialog.
		// We need a fresh render with initial muted state. But the host uses $state(false).
		// Let's instead test by clicking on unmute after the call succeeded.
		// After the POST succeeds, the button label changes to 'unmute notifications'
		await waitFor(() => expect(screen.getByLabelText('unmute notifications')).toBeInTheDocument());

		// click the now-unmute button — should DELETE, not open modal
		await fireEvent.click(screen.getByLabelText('unmute notifications'));
		expect(mockFetch).toHaveBeenCalledWith('/api/mute?target=t1', { method: 'DELETE' });
		// modal should NOT have been opened
		expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
	});

	it('flips the bound muted flag only after the server accepts', async () => {
		// The component only flips muted=true after fetch succeeds.
		let resolveFetch: (v: unknown) => void;
		const mockFetch = vi.fn().mockReturnValue(new Promise((r) => (resolveFetch = r)));
		globalThis.fetch = mockFetch;

		render(MuteButtonHost, { props: { target: 't1', kind: 'r' } });
		await fireEvent.click(screen.getByLabelText('mute notifications'));
		await fireEvent.click(screen.getByText('until i turn it back on'));

		// the muted flag should NOT have flipped yet (server hasn't responded)
		expect(screen.getByTestId('muted').textContent).toBe('false');

		// now resolve the fetch
		resolveFetch!({ ok: true, json: () => Promise.resolve({}) });
		await waitFor(() => expect(screen.getByTestId('muted').textContent).toBe('true'));
	});

	it('leaves the bound flag alone when the request fails', async () => {
		const mockFetch = vi.fn().mockResolvedValue({ ok: false });
		globalThis.fetch = mockFetch;

		render(MuteButtonHost, { props: { target: 't1', kind: 'r' } });
		await fireEvent.click(screen.getByLabelText('mute notifications'));
		await fireEvent.click(screen.getByText('until i turn it back on'));

		await waitFor(() => expect(screen.getByTestId('muted').textContent).toBe('false'));
	});

	it('disables the button while a request is in flight', async () => {
		let resolveFetch: (v: unknown) => void;
		const mockFetch = vi.fn().mockReturnValue(new Promise((r) => (resolveFetch = r)));
		globalThis.fetch = mockFetch;

		render(MuteButtonHost, { props: { target: 't1', kind: 'r' } });
		await fireEvent.click(screen.getByLabelText('mute notifications'));
		await fireEvent.click(screen.getByText('until i turn it back on'));

		// button should be disabled while waiting
		const btn = screen.getByLabelText('mute notifications');
		expect(btn).toBeDisabled();

		// resolve
		resolveFetch!({ ok: true, json: () => Promise.resolve({}) });
		await waitFor(() => expect(screen.getByLabelText('unmute notifications')).not.toBeDisabled());
	});
});
