import { describe, it, expect } from 'vitest';
import { profile_url } from '../links';

describe('profile_url', () => {
	it('links straight to the handle when the caller holds one', () => {
		expect(profile_url('ada', 'u1')).toBe('/@ada');
		expect(profile_url('ada_9', 'u1')).toBe('/@ada_9');
	});

	it('falls back to the uid when the caller holds no name at all', () => {
		expect(profile_url(undefined, 'u1')).toBe('/user/u1');
		expect(profile_url('', 'u1')).toBe('/user/u1');
	});

	it('falls back to the uid when the name is not a legal handle', () => {
		// get_user_names hands back the raw uid for anyone it cannot find
		expect(profile_url('3dfcae71-f891-4e65-a', 'u1')).toBe('/user/u1');
		expect(profile_url('Bob', 'u1')).toBe('/user/u1');
		expect(profile_url('ab', 'u1')).toBe('/user/u1');
	});
});
