import { describe, it, expect, vi, beforeEach } from 'vitest';
import { detect_location } from '../geo-client';

const origNavigator = globalThis.navigator;

function mockNavigator(overrides: Record<string, unknown>) {
	const nav = { ...origNavigator, ...overrides } as unknown as Navigator;
	Object.defineProperty(globalThis, 'navigator', {
		value: nav,
		configurable: true,
		writable: true
	});
}

beforeEach(() => {
	vi.restoreAllMocks();
	Object.defineProperty(globalThis, 'navigator', {
		value: origNavigator,
		configurable: true,
		writable: true
	});
});

describe('detect_location', () => {
	it('returns null without prompting when permission is already denied', async () => {
		const getCurrentPosition = vi.fn();
		mockNavigator({
			permissions: { query: vi.fn().mockResolvedValue({ state: 'denied' }) },
			geolocation: { getCurrentPosition }
		});
		expect(await detect_location()).toBeNull();
		expect(getCurrentPosition).not.toHaveBeenCalled();
	});

	it('maps a reverse-geocode hit to country, region and city', async () => {
		const getCurrentPosition = vi.fn((success: (pos: unknown) => void) =>
			success({ coords: { latitude: 6.5244, longitude: 3.3792 } })
		);
		mockNavigator({
			permissions: { query: vi.fn().mockResolvedValue({ state: 'prompt' }) },
			geolocation: { getCurrentPosition }
		});
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			json: () =>
				Promise.resolve({
					countryCode: 'NG',
					principalSubdivisionCode: 'NG-LA',
					city: 'Lagos'
				})
		});
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const result = await detect_location();
		expect(result).toEqual({ country: 'NG', region: 'LA', city: 'Lagos' });
		expect(fetchMock).toHaveBeenCalledWith(
			'https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=6.5244&longitude=3.3792&localityLanguage=en'
		);
	});
});
