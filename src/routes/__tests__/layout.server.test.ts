import { describe, it, expect } from 'vitest';
import { load } from '../+layout.server';

function event(pathname: string, user: unknown = null) {
	return { locals: { user }, url: new URL(`https://x${pathname}`) } as unknown as Parameters<typeof load>[0];
}

describe('root layout redirect', () => {
	it('redirects a logged-in user from / to /app/rooms', async () => {
		await expect(load(event('/', { id: 'u1' }))).rejects.toMatchObject({ status: 302, location: '/app/rooms' });
	});
	it('does not redirect a logged-out user from /', async () => {
		const result = await load(event('/'));
		expect(result).toEqual({ user: null });
	});
	it('still redirects a logged-in user away from /login to /app (unchanged)', async () => {
		await expect(load(event('/login', { id: 'u1' }))).rejects.toMatchObject({ status: 302, location: '/app' });
	});
	it('still redirects a logged-out user to /login for a protected route (unchanged)', async () => {
		await expect(load(event('/app/chats'))).rejects.toMatchObject({ status: 302, location: '/login' });
	});
	it('does not redirect a logged-out visitor from /app/rooms', async () => {
		const result = await load(event('/app/rooms'));
		expect(result).toEqual({ user: null });
	});
	it('does not redirect a logged-out visitor from a specific room page', async () => {
		const result = await load(event('/app/rooms/abc123'));
		expect(result).toEqual({ user: null });
	});
});
