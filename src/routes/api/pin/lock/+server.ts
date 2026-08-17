import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { clear_unlock } from '$lib/server/pin';

/**
 * Lock now. Called on the way out — a closing tab, a backgrounded app — usually by
 * `navigator.sendBeacon`, which is why it takes no body, checks nothing, and answers the
 * same way whether or not anyone was signed in.
 */
export const POST: RequestHandler = async ({ cookies }) => {
	clear_unlock(cookies);
	return json({ ok: true });
};
