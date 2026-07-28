import { describe, it, expect } from 'vitest';
import {
	cache_mode,
	cache_name,
	is_cacheable,
	notification_from,
	pick_client,
	should_notify,
	stale_caches,
	target_url,
	type SwClient
} from '../sw-core';

const ctx = {
	origin: 'https://x2.studio',
	assets: new Set(['/_app/immutable/chunk.abc123.js', '/logo.svg'])
};
const req = (url: string, o: Partial<{ method: string; mode: string; range: boolean }> = {}) => ({
	url,
	method: o.method ?? 'GET',
	mode: o.mode,
	range: o.range
});

describe('cache_mode', () => {
	it('bypasses anything that is not a GET — a send must never be replayed from cache', () => {
		expect(cache_mode(req('https://x2.studio/api/send', { method: 'POST' }), ctx)).toBe('bypass');
		expect(cache_mode(req('https://x2.studio/app', { method: 'HEAD' }), ctx)).toBe('bypass');
	});

	it('bypasses the API entirely — chat data is never stale-served', () => {
		expect(cache_mode(req('https://x2.studio/api/messages?peer=a'), ctx)).toBe('bypass');
		expect(cache_mode(req('https://x2.studio/api/wstoken'), ctx)).toBe('bypass');
	});

	it('bypasses the auth routes so a session is never cached', () => {
		expect(cache_mode(req('https://x2.studio/logout'), ctx)).toBe('bypass');
		expect(cache_mode(req('https://x2.studio/google?code=x'), ctx)).toBe('bypass');
		expect(cache_mode(req('https://x2.studio/login'), ctx)).toBe('bypass');
	});

	it('bypasses cross-origin requests', () => {
		expect(cache_mode(req('https://fonts.example.com/a.woff2'), ctx)).toBe('bypass');
	});

	it('bypasses non-http schemes such as extension requests', () => {
		expect(cache_mode(req('chrome-extension://abc/x.js'), ctx)).toBe('bypass');
	});

	it('bypasses a Range request — a 206 cannot be written to the cache', () => {
		expect(cache_mode(req('https://x2.studio/media/u/a.png', { range: true }), ctx)).toBe('bypass');
	});

	it('serves hashed build assets from cache first — their URL is their version', () => {
		expect(cache_mode(req('https://x2.studio/_app/immutable/chunk.abc123.js'), ctx)).toBe(
			'immutable'
		);
	});

	it('treats precached static files as immutable too', () => {
		expect(cache_mode(req('https://x2.studio/logo.svg'), ctx)).toBe('immutable');
	});

	it('serves uploaded media cache-first — R2 keys are immutable by construction', () => {
		expect(cache_mode(req('https://x2.studio/media/uid/abc.png'), ctx)).toBe('cache-first');
	});

	it('goes to the network first for a page navigation, so messages are fresh', () => {
		expect(cache_mode(req('https://x2.studio/app/chat/abc', { mode: 'navigate' }), ctx)).toBe(
			'network-first'
		);
	});

	it('goes network-first for anything else it might be asked for', () => {
		expect(cache_mode(req('https://x2.studio/manifest.webmanifest'), ctx)).toBe('network-first');
	});
});

describe('cache_name', () => {
	it('is namespaced and versioned so a deploy invalidates the whole shell', () => {
		expect(cache_name('1712.abc')).toBe('x2-1712.abc');
		expect(cache_name('a')).not.toBe(cache_name('b'));
	});
});

describe('stale_caches', () => {
	it('selects every x2 cache except the current one', () => {
		expect(stale_caches(['x2-old', 'x2-new'], 'x2-new')).toEqual(['x2-old']);
	});

	it('never touches caches belonging to something else on the origin', () => {
		expect(stale_caches(['other-app', 'x2-old'], 'x2-new')).toEqual(['x2-old']);
	});

	it('is empty on a first activate', () => {
		expect(stale_caches(['x2-new'], 'x2-new')).toEqual([]);
	});
});

describe('is_cacheable', () => {
	it('accepts a plain 200', () => {
		expect(is_cacheable({ status: 200, type: 'basic' })).toBe(true);
	});

	it('rejects a 206 — cache.put throws on partial content', () => {
		expect(is_cacheable({ status: 206, type: 'basic' })).toBe(false);
	});

	it('rejects errors and redirects', () => {
		expect(is_cacheable({ status: 404, type: 'basic' })).toBe(false);
		expect(is_cacheable({ status: 302, type: 'basic' })).toBe(false);
	});

	it('rejects an opaque cross-origin response', () => {
		expect(is_cacheable({ status: 0, type: 'opaque' })).toBe(false);
	});
});

describe('notification_from', () => {
	const p = {
		title: 'ada',
		body: 'are you around?',
		url: '/app/chat/ada-id',
		conv: 'ada-id|me',
		id: 'msg-1',
		ts: 1_700_000_000_000,
		unread: 3
	};

	it('shows the sender as the title and the message as the body', () => {
		const n = notification_from(p);
		expect(n.title).toBe('ada');
		expect(n.options.body).toBe('are you around?');
	});

	it('always produces something visible, even from an unparseable payload', () => {
		const n = notification_from(null);
		expect(n.title).toBeTruthy();
		expect(n.options.body).toBeTruthy();
	});

	it('tags per conversation so a burst of messages collapses into one', () => {
		expect(notification_from(p).options.tag).toBe('x2:ada-id|me');
		expect(notification_from({ ...p, conv: 'other' }).options.tag).toBe('x2:other');
	});

	it('renotifies, so a collapsed thread still alerts on a new message', () => {
		expect(notification_from(p).options.renotify).toBe(true);
	});

	it('carries an icon and a monochrome badge for the Android status bar', () => {
		const o = notification_from(p).options;
		expect(o.icon).toBe('/icons/icon-192.png');
		expect(o.badge).toBe('/icons/badge-96.png');
	});

	it('carries the click target and message identity in data', () => {
		expect(notification_from(p).options.data).toMatchObject({
			url: '/app/chat/ada-id',
			conv: 'ada-id|me',
			id: 'msg-1'
		});
	});

	it('uses the message timestamp so the OS orders and dates it correctly', () => {
		expect(notification_from(p).options.timestamp).toBe(1_700_000_000_000);
	});

	it('offers inline reply and mark-read actions on a real conversation', () => {
		const actions = notification_from(p).options.actions!;
		const reply = actions.find((a) => a.action === 'reply')!;
		expect(reply.type).toBe('text');
		expect(reply.placeholder).toBeTruthy();
		expect(actions.some((a) => a.action === 'mark-read')).toBe(true);
	});

	it('offers no actions when there is no conversation to act on', () => {
		expect(notification_from({ body: 'hi' }).options.actions ?? []).toEqual([]);
	});

	it('shows an attached photo as the notification image', () => {
		const o = notification_from({ ...p, image: '/media/u/a.png' }).options;
		expect(o.image).toBe('/media/u/a.png');
	});

	it('describes a photo-only message rather than showing an empty body', () => {
		const o = notification_from({ ...p, body: '', image: '/media/u/a.png' }).options;
		expect(o.body).toMatch(/photo/i);
	});

	it('does not demand interaction and is not silent', () => {
		const o = notification_from(p).options;
		expect(o.requireInteraction).toBe(false);
		expect(o.silent).toBe(false);
	});
});

describe('target_url', () => {
	it('uses the url the server sent', () => {
		expect(target_url({ url: '/app/chat/abc' })).toBe('/app/chat/abc');
	});

	it('falls back to the app home when the payload carries no url', () => {
		expect(target_url({})).toBe('/app');
		expect(target_url(null)).toBe('/app');
	});

	it('refuses an off-origin url — a push payload must not be an open redirect', () => {
		expect(target_url({ url: 'https://evil.example.com/x' })).toBe('/app');
		expect(target_url({ url: '//evil.example.com' })).toBe('/app');
	});
});

const client = (url: string, o: Partial<SwClient> = {}): SwClient =>
	({ url, focused: false, visibilityState: 'hidden', ...o }) as SwClient;

describe('pick_client', () => {
	it('prefers a window already on that conversation', () => {
		const want = client('https://x2.studio/app/chat/abc');
		expect(pick_client([client('https://x2.studio/app'), want], '/app/chat/abc')).toBe(want);
	});

	it('falls back to any open window rather than opening a second one', () => {
		const other = client('https://x2.studio/app');
		expect(pick_client([other], '/app/chat/abc')).toBe(other);
	});

	it('returns nothing when the app is not open at all', () => {
		expect(pick_client([], '/app/chat/abc')).toBeNull();
	});

	it('ignores query strings when matching the conversation', () => {
		const want = client('https://x2.studio/app/chat/abc?auto=text');
		expect(pick_client([want], '/app/chat/abc')).toBe(want);
	});
});

describe('should_notify', () => {
	it('stays quiet when the user is already looking at that conversation', () => {
		const focused = client('https://x2.studio/app/chat/abc', {
			focused: true,
			visibilityState: 'visible'
		});
		expect(should_notify([focused], '/app/chat/abc')).toBe(false);
	});

	it('notifies when that conversation is open but the window is in the background', () => {
		const hidden = client('https://x2.studio/app/chat/abc', {
			focused: false,
			visibilityState: 'hidden'
		});
		expect(should_notify([hidden], '/app/chat/abc')).toBe(true);
	});

	it('notifies when the focused window is on a different conversation', () => {
		const elsewhere = client('https://x2.studio/app/chat/zzz', {
			focused: true,
			visibilityState: 'visible'
		});
		expect(should_notify([elsewhere], '/app/chat/abc')).toBe(true);
	});

	it('notifies when nothing is open', () => {
		expect(should_notify([], '/app/chat/abc')).toBe(true);
	});
});
