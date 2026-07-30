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

	let geo: App.Geo | null = null;
	try {
		const cf = event.platform?.cf;
		if (cf) {
			const country = cf.country && cf.country !== 'XX' ? cf.country : null;
			const region = cf.regionCode ?? null;
			const region_name = cf.region ?? null;
			const city = cf.city || null;
			const tz = cf.timezone ?? null;
			if (country || region || region_name || city || tz) {
				geo = { country, region, region_name, city, tz };
			}
		}
	} catch {
		geo = null;
	}
	event.locals.geo = geo;

	let wait_until: ((p: Promise<unknown>) => void) | undefined;
	try {
		const ctx = event.platform?.ctx;
		if (ctx) wait_until = (p) => ctx.waitUntil(p);
	} catch {
		wait_until = undefined;
	}
	event.locals.bg = (p) => {
		const t = p.catch((e) => {
			console.error('[BG] background task failed', e);
		});
		if (wait_until) wait_until(t);
	};

	return resolve(event);
};
