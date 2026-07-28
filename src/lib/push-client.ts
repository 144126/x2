// Client-side Web Push enrollment. Runs in the browser only.

export function b64_to_bytes(s: string): Uint8Array {
	const t = s.replace(/-/g, '+').replace(/_/g, '/');
	const bin = atob(t.padEnd(Math.ceil(t.length / 4) * 4, '='));
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

type Unavailable = { ok: false; reason: 'unsupported' | 'ios-needs-install' | 'blocked' };
type Available = { ok: true };

function is_ios(): boolean {
	return /iPhone|iPad|iPod/.test(navigator.userAgent);
}

function is_standalone(): boolean {
	return (
		('standalone' in navigator && (navigator as unknown as { standalone?: boolean }).standalone === true) ||
		(typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)').matches === true)
	);
}

function has_push_apis(): boolean {
	return (
		typeof navigator !== 'undefined' &&
		'serviceWorker' in navigator &&
		typeof window !== 'undefined' &&
		'PushManager' in window &&
		typeof Notification !== 'undefined'
	);
}

export function push_available(): Available | Unavailable {
	if (!has_push_apis()) return { ok: false, reason: 'unsupported' };
	if (is_ios() && !is_standalone()) return { ok: false, reason: 'ios-needs-install' };
	return { ok: true };
}

export async function push_state(): Promise<'unsupported' | 'blocked' | 'off' | 'on'> {
	const avail = push_available();
	if (!avail.ok) return avail.reason === 'ios-needs-install' ? 'off' : 'unsupported';
	if (Notification.permission === 'denied') return 'blocked';
	if (Notification.permission !== 'granted') return 'off';
	const reg = await navigator.serviceWorker.ready;
	const sub = await reg.pushManager.getSubscription();
	return sub ? 'on' : 'off';
}

async function register_with_server(sub: PushSubscription): Promise<void> {
	const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
	await fetch('/api/push/subscribe', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys })
	}).catch(() => {});
}

export async function enable_push(vapid_public_key: string): Promise<Available | Unavailable> {
	const avail = push_available();
	if (!avail.ok) return avail;

	const permission = await Notification.requestPermission();
	if (permission !== 'granted') return { ok: false, reason: 'blocked' };

	const reg = await navigator.serviceWorker.ready;
	let sub = await reg.pushManager.getSubscription();
	if (!sub) {
		try {
			sub = await reg.pushManager.subscribe({
				userVisibleOnly: true,
				applicationServerKey: b64_to_bytes(vapid_public_key) as unknown as BufferSource
			});
		} catch {
			return { ok: false, reason: 'unsupported' };
		}
	}
	await register_with_server(sub);
	return { ok: true };
}

export async function disable_push(): Promise<boolean> {
	const reg = await navigator.serviceWorker.ready;
	const sub = await reg.pushManager.getSubscription();
	if (!sub) return false;
	const endpoint = sub.endpoint;
	await sub.unsubscribe().catch(() => {});
	await fetch('/api/push/unsubscribe', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ endpoint })
	}).catch(() => {});
	return true;
}

export async function sync_subscription(vapid_public_key: string): Promise<void> {
	if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
	const reg = await navigator.serviceWorker.ready;
	const sub = await reg.pushManager.getSubscription();
	if (!sub) return;
	void vapid_public_key;
	await register_with_server(sub);
}
