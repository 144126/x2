// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';

const {
	pushAvailableMock,
	pushStateMock,
	enablePushMock,
	hasSentMock,
	iosHintMock,
	dismissMock,
	hiddenMock
} = vi.hoisted(() => ({
	pushAvailableMock: vi.fn(),
	pushStateMock: vi.fn(),
	enablePushMock: vi.fn(),
	hasSentMock: vi.fn(),
	iosHintMock: vi.fn(),
	dismissMock: vi.fn(),
	hiddenMock: vi.fn()
}));

vi.mock('$lib/push-client', () => ({
	push_available: pushAvailableMock,
	push_state: pushStateMock,
	enable_push: enablePushMock
}));
vi.mock('$lib/notify-trigger', () => ({ has_sent: hasSentMock }));
vi.mock('$lib/install', () => ({
	ios_hint_needed: iosHintMock,
	dismiss_install: dismissMock,
	install_hidden: hiddenMock
}));

import NotifyPrompt from '../NotifyPrompt.svelte';

beforeEach(() => {
	vi.clearAllMocks();
	hasSentMock.mockReturnValue(true);
	hiddenMock.mockReturnValue(false);
	iosHintMock.mockReturnValue(false);
	pushAvailableMock.mockReturnValue({ ok: true });
	pushStateMock.mockResolvedValue('off');
	enablePushMock.mockResolvedValue({ ok: true });
});

describe('NotifyPrompt', () => {
	it('stays hidden until the user has sent a message', async () => {
		hasSentMock.mockReturnValue(false);
		render(NotifyPrompt, { props: { vapid_key: 'k' } });
		await new Promise((r) => setTimeout(r, 0));
		expect(screen.queryByText(/turn on notifications/i)).toBeNull();
	});

	it('stays hidden once already dismissed within the re-ask window', async () => {
		hiddenMock.mockReturnValue(true);
		render(NotifyPrompt, { props: { vapid_key: 'k' } });
		await new Promise((r) => setTimeout(r, 0));
		expect(screen.queryByText(/turn on notifications/i)).toBeNull();
	});

	it('offers to enable push once a message has been sent and push is off', async () => {
		render(NotifyPrompt, { props: { vapid_key: 'k' } });
		await waitFor(() => expect(screen.getByText(/turn on notifications/i)).toBeTruthy());
	});

	it('stays hidden when push is already on', async () => {
		pushStateMock.mockResolvedValue('on');
		render(NotifyPrompt, { props: { vapid_key: 'k' } });
		await new Promise((r) => setTimeout(r, 0));
		expect(screen.queryByText(/turn on notifications/i)).toBeNull();
	});

	it('shows the iOS install hint instead of the enable button on iOS Safari', async () => {
		iosHintMock.mockReturnValue(true);
		render(NotifyPrompt, { props: { vapid_key: 'k' } });
		await waitFor(() => expect(screen.getByText(/add to home screen/i)).toBeTruthy());
		expect(screen.queryByText(/^enable$/i)).toBeNull();
	});

	it('calls enable_push with the vapid key when the user taps enable', async () => {
		render(NotifyPrompt, { props: { vapid_key: 'my-key' } });
		await waitFor(() => screen.getByText(/enable/i));
		await fireEvent.click(screen.getByText(/enable/i));
		expect(enablePushMock).toHaveBeenCalledWith('my-key');
	});

	it('records the dismissal and hides the banner when the user dismisses it', async () => {
		render(NotifyPrompt, { props: { vapid_key: 'k' } });
		await waitFor(() => screen.getByLabelText(/dismiss/i));
		await fireEvent.click(screen.getByLabelText(/dismiss/i));
		expect(dismissMock).toHaveBeenCalled();
		expect(screen.queryByText(/turn on notifications/i)).toBeNull();
	});
});
