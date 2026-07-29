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
	// adapter-cloudflare's platform.env is a Proxy that throws on any property access while
	// prerendering (e.g. building the static /offline fallback) — there's no real platform then.
	let x2_ws: Fetcher | undefined;
	try {
		x2_ws = event.platform?.env?.X2_WS as Fetcher | undefined;
	} catch {
		x2_ws = undefined;
	}
	event.locals.x2_ws = x2_ws ?? devFetcher();
	return resolve(event);
};
