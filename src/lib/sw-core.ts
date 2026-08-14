// Pure logic for src/service-worker.ts — kept dependency-free so it can be unit tested
// under Node instead of only inside a real service worker.

export type CacheMode = 'bypass' | 'immutable' | 'cache-first' | 'network-first';

export type SwRequest = { url: string; method: string; mode?: string; range?: boolean };
export type SwContext = { origin: string; assets: Set<string> };

const BYPASS_PREFIXES = ['/api/', '/login', '/logout', '/google'];

export function cache_mode(req: SwRequest, ctx: SwContext): CacheMode {
	if (req.method !== 'GET') return 'bypass';
	if (req.range) return 'bypass';

	let url: URL;
	try {
		url = new URL(req.url);
	} catch {
		return 'bypass';
	}
	if (url.origin !== ctx.origin) return 'bypass';
	if (BYPASS_PREFIXES.some((p) => url.pathname === p || url.pathname.startsWith(p)))
		return 'bypass';

	if (ctx.assets.has(url.pathname) || url.pathname.startsWith('/_app/immutable/'))
		return 'immutable';
	if (url.pathname.startsWith('/media/')) return 'cache-first';
	return 'network-first';
}

export function cache_name(version: string): string {
	return `x2-${version}`;
}

export function stale_caches(names: string[], current: string): string[] {
	return names.filter((n) => n.startsWith('x2-') && n !== current);
}

export function is_cacheable(res: { status: number; type: string }): boolean {
	if (res.type === 'opaque') return false;
	return res.status === 200;
}

export type NotifyPayload = {
	title?: string;
	body?: string;
	url?: string;
	conv?: string;
	id?: string;
	ts?: number;
	unread?: number;
	image?: string;
	kind?: 'u' | 'r';
	reply_to?: string;
} | null;

export function notification_from(data: NotifyPayload): {
	title: string;
	options: {
		body: string;
		tag?: string;
		renotify: boolean;
		icon: string;
		badge: string;
		image?: string;
		data: { url: string; conv?: string; id?: string };
		timestamp?: number;
		actions: { action: string; title: string; type?: string; placeholder?: string }[];
		requireInteraction: boolean;
		silent: boolean;
	};
} {
	const p = data ?? {};
	const title = p.title || 'x2';
	const has_image = !!p.image;
	const body = p.body || (has_image ? 'sent a photo' : 'new message');
	const url = target_url(p);

	return {
		title,
		options: {
			body,
			...(p.conv ? { tag: `x2:${p.conv}`, renotify: true } : { renotify: true }),
			icon: '/icons/icon-192.png',
			badge: '/icons/badge-96.png',
			...(has_image ? { image: p.image } : {}),
			data: {
				url,
				conv: p.conv,
				id: p.id,
				kind: p.kind,
				...(p.reply_to ? { reply_to: p.reply_to } : {})
			},
			...(p.ts !== undefined ? { timestamp: p.ts } : {}),
			actions: p.conv
				? [
						{ action: 'reply', title: 'Reply', type: 'text', placeholder: 'Type a message…' },
						{ action: 'mark-read', title: 'Mark read' }
					]
				: [],
			requireInteraction: false,
			silent: false
		}
	};
}

export function target_url(data: { url?: string } | null): string {
	const raw = data?.url;
	if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return '/find';
	return raw;
}

export type SwClient = { url: string; focused: boolean; visibilityState: 'visible' | 'hidden' };

function conv_path(url: string): string {
	try {
		return new URL(url).pathname;
	} catch {
		return url;
	}
}

export function pick_client(clients: SwClient[], target: string): SwClient | null {
	const exact = clients.find((c) => conv_path(c.url) === target);
	if (exact) return exact;
	return clients[0] ?? null;
}

export function should_notify(clients: SwClient[], target: string): boolean {
	const on_target_and_focused = clients.some(
		(c) => c.focused && c.visibilityState === 'visible' && conv_path(c.url) === target
	);
	return !on_target_and_focused;
}

export function reply_body(
	data: { kind?: 'u' | 'r'; reply_to?: string } | null,
	text: string
): Record<string, unknown> | null {
	if (!data?.reply_to) return null;
	if (!text.trim()) return null;
	if (data.kind === 'r') return { group: data.reply_to, text };
	return { to: data.reply_to, text };
}
