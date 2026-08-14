import { describe, it, expect } from 'vitest';
import { GET as app_shim, POST as app_share } from '../app/[...rest]/+server';
import { GET as groups_shim } from '../groups/[...rest]/+server';
import { GET as room_shim } from '../rooms/[id]/+server';

// every shim throws its redirect synchronously, so the throw has to be caught rather than awaited
function hit(fn: (event: never) => unknown, event: unknown): unknown {
	try {
		fn(event as never);
	} catch (e) {
		return e;
	}
	throw new Error('expected a redirect');
}

const at = (rest: string, search = '') => ({
	params: { rest },
	url: new URL(`https://x/app/${rest}${search}`)
});

const moved = (to: string) => ({ status: 308, location: to });

describe('/app/* — the prefix that no longer exists', () => {
	it('lands the bare prefix on the page that used to live there', () => {
		expect(hit(app_shim, at(''))).toMatchObject(moved('/find'));
	});

	it('moves every page up a level', () => {
		expect(hit(app_shim, at('chats'))).toMatchObject(moved('/chats'));
		expect(hit(app_shim, at('rooms'))).toMatchObject(moved('/rooms'));
		expect(hit(app_shim, at('chat/bob'))).toMatchObject(moved('/chat/bob'));
	});

	it('sends an old profile link to the uid route, which resolves the handle', () => {
		expect(hit(app_shim, at('user/u1'))).toMatchObject(moved('/user/u1'));
	});

	it('keeps the query string, so a deep link with one still works', () => {
		expect(hit(app_shim, at('chat/bob', '?reply=m1'))).toMatchObject(moved('/chat/bob?reply=m1'));
	});

	it('redirects the share target too, which arrives as a POST', () => {
		expect(hit(app_share, at('share'))).toMatchObject(moved('/share'));
	});
});

describe('rooms — two renames deep', () => {
	it('sends a room id to its handle url', () => {
		expect(hit(room_shim, { params: { id: 'chess-club' } })).toMatchObject(moved('/~chess-club'));
	});

	it('still carries the oldest group links through', () => {
		expect(hit(groups_shim, { params: { rest: 'g1' } })).toMatchObject(moved('/~g1'));
		expect(hit(groups_shim, { params: { rest: '' } })).toMatchObject(moved('/rooms'));
	});
});
