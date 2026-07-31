import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$env/dynamic/private', () => ({ env: { SECRET: 'test-secret', WS_ORIGIN: 'wss://ws.example.com' } }));
vi.mock('$app/environment', () => ({ dev: false }));

import { GET } from '../+server';

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date('2026-06-01T00:00:00Z'));
});

describe('GET /api/wstoken', () => {
	it('returns HMAC token, uid, 5-min exp; no credentials in ws URL', async () => {
		const res = await GET({
			locals: { user: { id: 'u1', username: 'ada' } }
		} as never);
		const body = await res.json();
		expect(body).toHaveProperty('t');
		expect(body.uid).toBe('u1');
		expect(body.exp).toBeGreaterThan(Date.now());
		expect(body.exp).toBeLessThan(Date.now() + 310_000);
		expect(body.ws).toBe('wss://ws.example.com/ws');
		expect(body.ws).not.toContain('u1');
	});

	it('returns a 64-char hex token', async () => {
		const res = await GET({
			locals: { user: { id: 'u1', username: 'a' } }
		} as never);
		const body = await res.json();
		expect(body.t).toMatch(/^[0-9a-f]{64}$/);
	});

	it('401s when not signed in', async () => {
		await expect(
			GET({ locals: { user: null } } as never)
		).rejects.toMatchObject({ status: 401 });
	});
});
