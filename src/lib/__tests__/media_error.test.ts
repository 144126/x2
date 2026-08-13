import { describe, it, expect } from 'vitest';
import { media_error } from '../call';

describe('media_error', () => {
	it('names a denied permission', () => {
		const e = new Error('denied');
		e.name = 'NotAllowedError';
		expect(media_error(e)).toMatch(/permission was denied/);
	});
	it('names a missing device', () => {
		const e = new Error('none');
		e.name = 'NotFoundError';
		expect(media_error(e)).toMatch(/no camera or mic/);
	});
	it('names an insecure origin', () => {
		expect(media_error(new Error('media_unavailable'))).toMatch(/https/);
	});
	it('falls back with the error name', () => {
		const e = new Error('boom');
		e.name = 'AbortError';
		expect(media_error(e)).toContain('AbortError');
	});
});
