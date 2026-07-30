import { describe, it, expect } from 'vitest';
import { resolve_tz, local_time } from '../tz';

describe('resolve_tz', () => {
	it('prefers a stored timezone', async () => {
		expect(await resolve_tz({ tz: 'Europe/Berlin', co: 'US' })).toBe('Europe/Berlin');
	});

	it('falls back to the country zone when there is exactly one', async () => {
		expect(await resolve_tz({ co: 'NG' })).toBe('Africa/Lagos');
	});

	it('refuses to guess in a multi-zone country', async () => {
		expect(await resolve_tz({ co: 'US' })).toBeUndefined();
	});

	it('returns undefined with no country and no stored zone', async () => {
		expect(await resolve_tz({})).toBeUndefined();
	});

	it('ignores an unknown country code', async () => {
		expect(await resolve_tz({ co: 'ZZ' })).toBeUndefined();
	});
});

describe('local_time', () => {
	it('formats the time in the target zone', () => {
		expect(local_time('Africa/Lagos', Date.UTC(2026, 6, 30, 12, 0))).toBe('13:00');
	});
});
