import { describe, it, expect, vi, afterEach } from 'vitest';
import { encode_session, decode_session, type SessionUser } from '../session';

const SECRET = 'session-secret-value';
const USER: SessionUser = {
	id: 'uid-1',
	username: 'ada',
	picture: 'pic.png',
	email: 'ada@example.com'
};

afterEach(() => {
	vi.useRealTimers();
});

describe('encode_session / decode_session', () => {
	it('round-trips a valid session', async () => {
		const token = await encode_session(SECRET, USER);
		const decoded = await decode_session(SECRET, token);
		expect(decoded).not.toBeNull();
		expect(decoded!.user).toEqual(USER);
	});

	it('omits optional fields cleanly', async () => {
		const token = await encode_session(SECRET, { id: 'uid-2', username: 'no_extras' });
		const decoded = await decode_session(SECRET, token);
		expect(decoded!.user.id).toBe('uid-2');
		expect(decoded!.user.username).toBe('no_extras');
		expect(decoded!.user.picture).toBeUndefined();
		expect(decoded!.user.email).toBeUndefined();
	});

	it('rejects a token signed with a different secret', async () => {
		const token = await encode_session(SECRET, USER);
		expect(await decode_session('a-different-secret', token)).toBeNull();
	});

	it('rejects a tampered payload', async () => {
		const token = await encode_session(SECRET, USER);
		const [raw, sig] = token.split('.');
		const tampered = raw.slice(0, -2) + (raw.slice(-2) === 'AA' ? 'BB' : 'AA') + '.' + sig;
		expect(await decode_session(SECRET, tampered)).toBeNull();
	});

	it('rejects null/undefined/empty cookies', async () => {
		expect(await decode_session(SECRET, null)).toBeNull();
		expect(await decode_session(SECRET, undefined)).toBeNull();
		expect(await decode_session(SECRET, '')).toBeNull();
	});

	it('rejects malformed cookies without a dot separator', async () => {
		expect(await decode_session(SECRET, 'not-a-valid-token')).toBeNull();
	});

	it('rejects an expired session', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
		const token = await encode_session(SECRET, USER);
		vi.setSystemTime(new Date('2026-01-09T00:00:00Z')); // 8 days later, past the 7-day expiry
		expect(await decode_session(SECRET, token)).toBeNull();
	});

	it('accepts a session right before expiry', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
		const token = await encode_session(SECRET, USER);
		vi.setSystemTime(new Date('2026-01-06T00:00:00Z')); // 5 days later, still within 7-day expiry
		expect(await decode_session(SECRET, token)).not.toBeNull();
	});

	it('resolves a secrets-store-style secret binding', async () => {
		const binding = { get: async () => SECRET };
		const token = await encode_session(binding, USER);
		expect(await decode_session(binding, token)).not.toBeNull();
	});
});
