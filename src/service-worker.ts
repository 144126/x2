/// <reference types="@sveltejs/kit" />
import { build, files, version } from '$service-worker';
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
} from '$lib/sw-core';
import { drain, type Outgoing, type OutStore } from '$lib/outbox';

declare const self: ServiceWorkerGlobalScope;

const CACHE = cache_name(version);
const PRECACHE = [...build, ...files, '/offline'];

self.addEventListener('install', (event) => {
	event.waitUntil(
		(async () => {
			const cache = await caches.open(CACHE);
			await cache.addAll(PRECACHE);
			await self.skipWaiting();
		})()
	);
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			const names = await caches.keys();
			await Promise.all(stale_caches(names, CACHE).map((n) => caches.delete(n)));
			await self.clients.claim();
		})()
	);
});

self.addEventListener('fetch', (event) => {
	const req = event.request;
	const mode = cache_mode(
		{
			url: req.url,
			method: req.method,
			mode: req.mode,
			range: req.headers.has('range')
		},
		{ origin: self.location.origin, assets: new Set(files) }
	);
	if (mode === 'bypass') return;

	event.respondWith(
		(async () => {
			const cache = await caches.open(CACHE);

			if (mode === 'immutable' || mode === 'cache-first') {
				const cached = await cache.match(req);
				if (cached) return cached;
				try {
					const res = await fetch(req);
					if (is_cacheable(res)) await cache.put(req, res.clone());
					return res;
				} catch {
					return cached ?? (req.mode === 'navigate' ? (await cache.match('/offline'))! : Response.error());
				}
			}

			// network-first
			try {
				const res = await fetch(req);
				if (is_cacheable(res)) await cache.put(req, res.clone());
				return res;
			} catch {
				const cached = await cache.match(req);
				if (cached) return cached;
				if (req.mode === 'navigate') return (await cache.match('/offline'))!;
				return Response.error();
			}
		})()
	);
});

self.addEventListener('push', (event) => {
	event.waitUntil(
		(async () => {
			let data: unknown = null;
			try {
				data = event.data?.json();
			} catch {
				data = null;
			}
			const url = target_url(data as { url?: string } | null);

			const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
			const sw_clients: SwClient[] = clients.map((c) => ({
				url: c.url,
				focused: (c as WindowClient).focused ?? false,
				visibilityState: (c as WindowClient).visibilityState ?? 'hidden'
			}));

			if (!should_notify(sw_clients, url)) return;

			const { title, options } = notification_from(data as Parameters<typeof notification_from>[0]);
			await self.registration.showNotification(title, options as NotificationOptions);
		})()
	);
});

self.addEventListener('notificationclick', (event) => {
	const data = event.notification.data as { url?: string; conv?: string; id?: string } | undefined;
	const url = data?.url ?? '/app';

	if (event.action === 'mark-read' && data?.conv) {
		event.waitUntil(
			fetch('/api/read', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ conv: data.conv })
			}).catch(() => {})
		);
		return;
	}

	if (event.action === 'reply' && data?.conv) {
		const reply = (event as NotificationEvent & { reply?: string }).reply;
		if (reply) {
			event.waitUntil(
				fetch('/api/send', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ to: data.conv.split('|').find((u) => u !== data.id), text: reply })
				}).catch(() => {})
			);
		}
		return;
	}

	event.notification.close();
	event.waitUntil(
		(async () => {
			const clients = (await self.clients.matchAll({ type: 'window' })) as WindowClient[];
			const target = pick_client(
				clients.map((c) => ({ url: c.url, focused: c.focused, visibilityState: c.visibilityState })),
				url
			);
			const match = target ? clients.find((c) => c.url === target.url) : null;
			if (match) {
				await match.focus();
				if (match.url !== new URL(url, self.location.origin).href) match.navigate(url);
			} else {
				await self.clients.openWindow(url);
			}
		})()
	);
});

const OUTBOX_DB = 'x2-outbox';

async function outbox_store(): Promise<OutStore> {
	const db = await new Promise<IDBDatabase>((resolve, reject) => {
		const req = indexedDB.open(OUTBOX_DB, 1);
		req.onupgradeneeded = () => req.result.createObjectStore('messages', { keyPath: 'id' });
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
	const tx = (mode: IDBTransactionMode) => db.transaction('messages', mode).objectStore('messages');
	return {
		all: () =>
			new Promise((resolve, reject) => {
				const req = tx('readonly').getAll();
				req.onsuccess = () => resolve(req.result as Outgoing[]);
				req.onerror = () => reject(req.error);
			}),
		put: (o) =>
			new Promise((resolve, reject) => {
				const req = tx('readwrite').put(o);
				req.onsuccess = () => resolve();
				req.onerror = () => reject(req.error);
			}),
		del: (id) =>
			new Promise((resolve, reject) => {
				const req = tx('readwrite').delete(id);
				req.onsuccess = () => resolve();
				req.onerror = () => reject(req.error);
			})
	};
}

self.addEventListener('sync', (event) => {
	if (event.tag !== 'x2-outbox') return;
	event.waitUntil(
		(async () => {
			const store = await outbox_store();
			await drain(store, async (body) => {
				try {
					const res = await fetch('/api/send', {
						method: 'POST',
						headers: { 'content-type': 'application/json' },
						body: JSON.stringify(body)
					});
					return res.ok;
				} catch {
					return false;
				}
			});
		})()
	);
});
