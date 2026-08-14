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
	it('lets a logged-out visitor browse rooms, read one, and look at a profile', async () => {
		for (const path of ['/rooms', '/~abc123', '/@ada', '/find']) {
			expect(await load(event(path))).toEqual({ user: null });
		}
	});
	it('lets a logged-out visitor through the old room shims, which only redirect', async () => {
		expect(await load(event('/rooms/abc123'))).toEqual({ user: null });
		expect(await load(event('/groups/abc123'))).toEqual({ user: null });
	});
});
