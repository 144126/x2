import { validatePhoneNumberLength } from 'libphonenumber-js/min';

export function phone_length_error(phone: string, country: string | null): string | null {
	if (!country) return null;
	const result = validatePhoneNumberLength(phone, country);
	if (result === undefined) return null;
	if (result === 'INVALID_COUNTRY') return null;
	if (result === 'TOO_SHORT') return 'Number is too short for this country';
	if (result === 'TOO_LONG') return 'Number is too long for this country';
	if (result === 'NOT_A_NUMBER') return 'Not a valid phone number';
	return null;
}
