import { dev } from '$app/environment';
import { decode_session } from '$lib/server/session';
import type { Handle } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

function devFetcher(): Fetcher {
	return {
		async fetch(input: RequestInfo | URL, init?: RequestInit) {
			const url = new URL(input.toString());
			return fetch(`http://localhost:8787${url.pathname}${url.search}`, init);
		}
	};
}

export const handle: Handle = async ({ event, resolve }) => {
	const session_id = event.cookies.get('session');
	event.locals.user = null;
	if (session_id) {
		const s = await decode_session(env.SECRET, session_id);
		if (s) event.locals.user = s.user;
		else event.cookies.delete('session', { path: '/' });
	}
	event.locals.x2_ws = (event.platform?.env?.X2_WS as Fetcher | undefined) ?? devFetcher();
	return resolve(event);
};