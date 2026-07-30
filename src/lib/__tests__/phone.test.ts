import { describe, it, expect } from 'vitest';
import { phone_length_error } from '../phone';

describe('phone_length_error', () => {
	it('returns null when country is null', () => {
		expect(phone_length_error('+2348012345678', null)).toBeNull();
	});

	it('returns null for a valid Nigerian number with country code', () => {
		expect(phone_length_error('+2348012345678', 'NG')).toBeNull();
	});

	it('returns null for a valid Nigerian number without country code', () => {
		expect(phone_length_error('08012345678', 'NG')).toBeNull();
	});

	it('returns TOO_SHORT for a short Nigerian number with country code', () => {
		expect(phone_length_error('+23480123', 'NG')).toBe('Number is too short for this country');
	});

	it('returns TOO_SHORT for a very short Nigerian number', () => {
		expect(phone_length_error('80123', 'NG')).toBe('Number is too short for this country');
	});

	it('returns TOO_LONG for an over-long US number', () => {
		expect(phone_length_error('+141555526711', 'US')).toBe('Number is too long for this country');
	});

	it('returns NOT_A_NUMBER for non-numeric input', () => {
		expect(phone_length_error('abc', 'NG')).toBe('Not a valid phone number');
	});

	it('returns NOT_A_NUMBER for empty string', () => {
		expect(phone_length_error('', 'NG')).toBe('Not a valid phone number');
	});

	it('returns null for INVALID_COUNTRY (unknown country)', () => {
		expect(phone_length_error('+2348012345678', 'ZZ')).toBeNull();
	});
});
