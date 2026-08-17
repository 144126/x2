import { decode_session } from '$lib/server/session';
import {
	clear_unlock,
	decode_unlock,
	encode_unlock,
	open_while_locked,
	set_unlock,
	unlocks
} from '$lib/server/pin';
import { error, redirect, type Handle } from '@sveltejs/kit';
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
	// adapter-cloudflare's platform.env is a Proxy that throws on any property access while
	// prerendering (e.g. building the static /offline fallback) — there's no real platform then.
	let x2_ws: Fetcher | undefined;
	try {
		x2_ws = event.platform?.env?.X2_WS as Fetcher | undefined;
	} catch {
		x2_ws = undefined;
	}
	event.locals.x2_ws = x2_ws ?? devFetcher();

	let device_id = event.cookies.get('device_id');
	if (!device_id) {
		device_id = crypto.randomUUID();
		event.cookies.set('device_id', device_id, {
			path: '/',
			httpOnly: true,
			maxAge: 60 * 60 * 24 * 400,
			sameSite: 'lax'
		});
	}
	event.locals.device_id = device_id;

	const session_id = event.cookies.get('session');
	event.locals.user = null;
	let pin_v = 0;
	if (session_id) {
		const s = await decode_session(env.SECRET, session_id);
		if (s) {
			event.locals.user = s.user;
			event.locals.session_v = s.v;
			pin_v = s.pin;
		} else {
			event.cookies.delete('session', { path: '/' });
		}
	}

	// The app lock. The pin version rides inside the HMAC-signed session cookie, so a browser
	// that holds a session cannot lie about whether that account is locked, and the check
	// costs no round trip. Unlocking mints a second signed cookie tied to that same version —
	// changing or clearing the pin bumps the version and every outstanding unlock dies.
	event.locals.pin_on = pin_v > 0;
	event.locals.pin_v = pin_v;
	event.locals.pin_locked = false;
	if (event.locals.user && pin_v > 0) {
		const uid = event.locals.user.id;
		const tok = await decode_unlock(env.SECRET, event.cookies.get('pin'));
		if (unlocks(tok, uid, pin_v)) {
			set_unlock(event.cookies, await encode_unlock(env.SECRET, uid, pin_v));
		} else {
			event.locals.pin_locked = true;
			if (event.cookies.get('pin')) clear_unlock(event.cookies);
			if (!open_while_locked(event.url.pathname)) {
				// A page gets sent to the lock screen; anything else is simply refused, because a
				// locked browser must never receive a byte of the account's own data.
				if (event.isDataRequest || event.request.headers.get('accept')?.includes('text/html')) {
					const back = event.url.pathname + event.url.search;
					throw redirect(302, '/lock' + (back === '/' ? '' : `?r=${encodeURIComponent(back)}`));
				}
				throw error(423, 'locked');
			}
		}
	}

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

	const res = await resolve(event);
	// Tells the service worker whether this account is locked-capable. It stops caching pages
	// and media the moment this turns on, and throws away whatever it already holds — an
	// offline reload must never repaint a thread the pin was supposed to be hiding.
	if (event.locals.user) res.headers.set('x-pin', event.locals.pin_on ? '1' : '0');
	return res;
};
