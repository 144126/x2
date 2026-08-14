import { describe, it, expect } from 'vitest';
import { load } from '../+layout.server';

function event(pathname: string, user: unknown = null) {
	return { locals: { user }, url: new URL(`https://x${pathname}`) } as unknown as Parameters<
		typeof load
	>[0];
}

describe('root layout redirect', () => {
	it('leaves a logged-in user on / — the homepage is the voice match, not a redirect', async () => {
		expect(await load(event('/', { id: 'u1' }))).toEqual({ user: { id: 'u1' } });
	});
	it('does not redirect a logged-out user from /', async () => {
		const result = await load(event('/'));
		expect(result).toEqual({ user: null });
	});
	it('still redirects a logged-in user away from /login to /find (unchanged)', async () => {
		await expect(load(event('/login', { id: 'u1' }))).rejects.toMatchObject({
			status: 302,
			location: '/find'
		});
	});
	it('still redirects a logged-out user to /login for a protected route (unchanged)', async () => {
		await expect(load(event('/chats'))).rejects.toMatchObject({
			status: 302,
			location: '/login'
		});
	});
	it('redirects a logged-out visitor from /rooms to /login', async () => {
		await expect(load(event('/rooms'))).rejects.toMatchObject({
			status: 302,
			location: '/login'
		});
	});
	it('redirects a logged-out visitor from a specific room page to /login', async () => {
		await expect(load(event('/rooms/abc123'))).rejects.toMatchObject({
			status: 302,
			location: '/login'
		});
	});
});
