// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';

const { watchMock, canInstallMock, installMock, hiddenMock, dismissMock } = vi.hoisted(() => ({
	watchMock: vi.fn(),
	canInstallMock: vi.fn(),
	installMock: vi.fn(),
	hiddenMock: vi.fn(),
	dismissMock: vi.fn()
}));

vi.mock('$lib/install', () => ({
	watch_install: watchMock,
	can_install: canInstallMock,
	install: installMock,
	install_hidden: hiddenMock,
	dismiss_install: dismissMock
}));

import InstallBanner from '../InstallBanner.svelte';

beforeEach(() => {
	vi.useFakeTimers();
	vi.clearAllMocks();
	watchMock.mockReturnValue(() => {});
	canInstallMock.mockReturnValue(false);
	hiddenMock.mockReturnValue(false);
	installMock.mockResolvedValue('accepted');
});

afterEach(() => {
	vi.useRealTimers();
});

describe('InstallBanner', () => {
	it('registers install-event listeners on mount', () => {
		render(InstallBanner);
		expect(watchMock).toHaveBeenCalled();
	});

	it('stays hidden until the browser reports the app installable', async () => {
		render(InstallBanner);
		await vi.advanceTimersByTimeAsync(1000);
		expect(screen.queryByText(/install x2/i)).toBeNull();
	});

	it('shows the banner once the browser fires beforeinstallprompt', async () => {
		canInstallMock.mockReturnValue(true);
		render(InstallBanner);
		await vi.advanceTimersByTimeAsync(1000);
		expect(screen.getByText(/install x2/i)).toBeTruthy();
	});

	it('stays hidden if it was already dismissed within the re-ask window', async () => {
		canInstallMock.mockReturnValue(true);
		hiddenMock.mockReturnValue(true);
		render(InstallBanner);
		await vi.advanceTimersByTimeAsync(1000);
		expect(screen.queryByText(/install x2/i)).toBeNull();
	});

	it('triggers the native prompt when tapped', async () => {
		canInstallMock.mockReturnValue(true);
		render(InstallBanner);
		await vi.advanceTimersByTimeAsync(1000);
		await fireEvent.click(screen.getByText(/^install$/i));
		expect(installMock).toHaveBeenCalled();
	});

	it('records the dismissal and hides when the user dismisses it', async () => {
		canInstallMock.mockReturnValue(true);
		render(InstallBanner);
		await vi.advanceTimersByTimeAsync(1000);
		await fireEvent.click(screen.getByLabelText(/dismiss/i));
		expect(dismissMock).toHaveBeenCalled();
		expect(screen.queryByText(/install x2/i)).toBeNull();
	});

	it('stops polling once torn down', async () => {
		const { unmount } = render(InstallBanner);
		unmount();
		canInstallMock.mockReturnValue(true);
		await vi.advanceTimersByTimeAsync(2000);
		expect(screen.queryByText(/install x2/i)).toBeNull();
	});
});
