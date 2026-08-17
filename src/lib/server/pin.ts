import type { Cookies } from '@sveltejs/kit';
import { get_key } from './session';
import { get_secret, b64u, unb64u, type SecretVal } from './qdrant';
import { hash_pw, verify_pw } from './pw';

export { MIN, MAX } from '../pin-limits';
import { MIN, MAX } from '../pin-limits';

/**
 * No request for this long and the unlock dies. The cookie carries no Max-Age either, so
 * closing the browser or the installed app drops it too — every launch starts locked.
 */
export const IDLE_MS = 900_000;

/** Misses allowed before the lockout starts. */
export const FREE_TRIES = 4;

export function valid_pin(p: unknown): p is string {
	return typeof p === 'string' && /^\d+$/.test(p) && p.length >= MIN && p.length <= MAX;
}

// A 4-digit pin is 10,000 guesses, so PBKDF2 alone would not survive a dumped user record.
// The pin is peppered with the server secret first: without SECRET — which never leaves the
// Secrets Store — the stored value cannot be attacked offline at all. The uid goes in so the
// same pin on two accounts never produces the same peppered input.
async function peppered(secret: string, uid: string, pin: string): Promise<string> {
	const k = await get_key(secret);
	const sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(`pin:${uid}:${pin}`));
	return b64u(sig);
}

export async function hash_pin(secret: SecretVal, uid: string, pin: string): Promise<string> {
	return hash_pw(await peppered(await get_secret(secret), uid, pin));
}

export async function verify_pin(
	secret: SecretVal,
	uid: string,
	pin: string,
	stored: string | undefined
): Promise<boolean> {
	if (!stored) return false;
	return verify_pw(await peppered(await get_secret(secret), uid, pin), stored);
}

// Escalating wait after a miss. Kept on the user record rather than in memory so it survives
// a colo change, a worker restart, and a fresh browser — the attacker holding the phone
// cannot reset it by clearing cookies.
const STEPS = [0, 0, 0, 0, 0, 30_000, 60_000, 300_000, 900_000, 3_600_000];

export function lockout_ms(fails: number): number {
	if (fails <= 0) return 0;
	return STEPS[Math.min(fails, STEPS.length - 1)];
}

export type Unlock = { u: string; v: number; e: number };

/** Signed proof that this browser passed the pin. `v` pins it to one pin version. */
export async function encode_unlock(
	secret: SecretVal,
	uid: string,
	v: number,
	now = Date.now()
): Promise<string> {
	const raw = b64u(new TextEncoder().encode(JSON.stringify({ u: uid, v, e: now + IDLE_MS })));
	const k = await get_key(await get_secret(secret));
	const sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(raw));
	return raw + '.' + b64u(sig);
}

export async function decode_unlock(
	secret: SecretVal,
	token: string | undefined | null,
	now = Date.now()
): Promise<Unlock | null> {
	if (!token) return null;
	const [raw, sig] = token.split('.');
	if (!raw || !sig) return null;
	try {
		const k = await get_key(await get_secret(secret));
		const valid = await crypto.subtle.verify(
			'HMAC',
			k,
			unb64u(sig).buffer as ArrayBuffer,
			new TextEncoder().encode(raw)
		);
		if (!valid) return null;
		const p = JSON.parse(new TextDecoder().decode(unb64u(raw))) as Unlock;
		if (!p.u || typeof p.v !== 'number' || !(p.e > now)) return null;
		return p;
	} catch {
		return null;
	}
}

/** True when this token unlocks this exact user at this exact pin version. */
export function unlocks(u: Unlock | null, uid: string, v: number): boolean {
	return !!u && u.u === uid && u.v === v;
}

// Deliberately no Max-Age: a session cookie dies with the browser and with the installed
// app's last window, which is what makes every launch start locked.
export function set_unlock(cookies: Cookies, token: string): void {
	cookies.set('pin', token, { path: '/', httpOnly: true, sameSite: 'lax' });
}

export function clear_unlock(cookies: Cookies): void {
	cookies.delete('pin', { path: '/' });
}

// Everything a locked browser may still reach: the lock screen itself, the calls that unlock
// or reset it, the ways out of the account, and the shell assets the lock screen is built
// from. Nothing here reads a message, a profile, a room, or a media object. Anything not
// listed is refused, so a new route is locked the day it is added rather than the day
// someone remembers to add it.
const OPEN = [
	'/lock',
	'/login',
	'/logout',
	'/google',
	'/offline',
	'/api/pin/unlock',
	'/api/pin/lock',
	'/api/pin/reset'
];
const OPEN_PREFIX = ['/_app/', '/icons/', '/fonts/'];
const OPEN_FILE = /^\/[^/]+\.(css|js|svg|png|ico|webmanifest|json|woff2?)$/;

export function open_while_locked(pathname: string): boolean {
	// SvelteKit asks for a page's data at `/<route>/__data.json` on a client-side
	// navigation, so the route has to be recovered before it can be judged.
	const p = pathname.endsWith('/__data.json')
		? pathname.slice(0, -'/__data.json'.length) || '/'
		: pathname;
	if (OPEN.includes(p)) return true;
	if (OPEN_PREFIX.some((x) => p.startsWith(x))) return true;
	return OPEN_FILE.test(p);
}
