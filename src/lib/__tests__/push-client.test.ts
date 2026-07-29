import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const KEY =
	'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8';

class FakeSubscription {
	endpoint = 'https://push.example.net/push/abc';
	unsubscribe = vi.fn().mockResolvedValue(true);
	options: { applicationServerKey?: BufferSource } = {};
	toJSON() {
		return { endpoint: this.endpoint, keys: { p256dh: 'PUB', auth: 'AUTH' } };
	}
}

type Env = {
	permission?: NotificationPermission;
	existing?: FakeSubscription | null;
	ua?: string;
	standalone?: boolean;
	supported?: boolean;
};

let subscribe: ReturnType<typeof vi.fn>;
let requestPermission: ReturnType<typeof vi.fn>;
let fetchMock: ReturnType<typeof vi.fn>;
let mod: typeof import('../push-client');

async function setup(e: Env = {}) {
	const {
		permission = 'default',
		existing = null,
		ua = 'Mozilla/5.0 (X11; Linux) Chrome/140',
		standalone = false,
		supported = true
	} = e;

	subscribe = vi.fn(async () => new FakeSubscription());
	requestPermission = vi.fn(async () => permission);
	fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));

	const registration = {
		pushManager: { subscribe, getSubscription: vi.fn(async () => existing) }
	};

	vi.stubGlobal('navigator', {
		userAgent: ua,
		...(supported
			? { serviceWorker: { ready: Promise.resolve(registration), register: vi.fn() } }
			: {}),
		...(standalone ? { standalone: true } : {})
	});
	vi.stubGlobal('window', {
		...(supported ? { PushManager: class {} } : {}),
		matchMedia: (q: string) => ({ matches: standalone && q.includes('standalone') })
	} as unknown as Window);
	if (supported) vi.stubGlobal('Notification', { permission, requestPermission });
	else vi.stubGlobal('Notification', undefined);
	vi.stubGlobal('fetch', fetchMock);

	vi.resetModules();
	mod = await import('../push-client');
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});

describe('b64_to_bytes', () => {
	beforeEach(() => setup());

	it('decodes an unpadded base64url VAPID key to the 65-byte P-256 point', () => {
		const bytes = mod.b64_to_bytes(KEY);
		expect(bytes.length).toBe(65);
		expect(bytes[0]).toBe(0x04); // uncompressed point marker
	});

	it('handles base64url alphabet, not plain base64', () => {
		expect([...mod.b64_to_bytes('_-8')]).toEqual([255, 239]);
	});
});

describe('push_available', () => {
	it('is available in a normal browser with push support', async () => {
		await setup();
		expect(mod.push_available()).toEqual({ ok: true });
	});

	it('is unsupported when the browser has no PushManager', async () => {
		await setup({ supported: false });
		expect(mod.push_available()).toMatchObject({ ok: false, reason: 'unsupported' });
	});

	it('tells an iOS user to install first — Safari only grants push to installed apps', async () => {
		await setup({ ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4) Safari/605', standalone: false });
		expect(mod.push_available()).toMatchObject({ ok: false, reason: 'ios-needs-install' });
	});

	it('is available on iOS once the app runs standalone', async () => {
		await setup({ ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4) Safari/605', standalone: true });
		expect(mod.push_available()).toEqual({ ok: true });
	});
});

describe('push_state', () => {
	it('is off before the user has ever been asked', async () => {
		await setup({ permission: 'default' });
		expect(await mod.push_state()).toBe('off');
	});

	it('is blocked once the user has denied — never ask again', async () => {
		await setup({ permission: 'denied' });
		expect(await mod.push_state()).toBe('blocked');
	});

	it('is off when permission is granted but this device has no subscription', async () => {
		await setup({ permission: 'granted', existing: null });
		expect(await mod.push_state()).toBe('off');
	});

	it('is on when this device holds a live subscription', async () => {
		await setup({ permission: 'granted', existing: new FakeSubscription() });
		expect(await mod.push_state()).toBe('on');
	});

	it('is unsupported where the APIs are missing', async () => {
		await setup({ supported: false });
		expect(await mod.push_state()).toBe('unsupported');
	});
});

describe('enable_push', () => {
	it('asks for permission — this is only ever called from a user gesture', async () => {
		await setup({ permission: 'granted' });
		await mod.enable_push(KEY);
		expect(requestPermission).toHaveBeenCalled();
	});

	it('stops without subscribing when the user denies', async () => {
		await setup({ permission: 'denied' });
		expect(await mod.enable_push(KEY)).toMatchObject({ ok: false, reason: 'blocked' });
		expect(subscribe).not.toHaveBeenCalled();
	});

	it('subscribes with userVisibleOnly and the decoded server key', async () => {
		await setup({ permission: 'granted' });
		await mod.enable_push(KEY);
		const opts = subscribe.mock.calls[0][0];
		expect(opts.userVisibleOnly).toBe(true);
		expect(new Uint8Array(opts.applicationServerKey)).toEqual(mod.b64_to_bytes(KEY));
	});

	it('registers the subscription with the server', async () => {
		await setup({ permission: 'granted' });
		await mod.enable_push(KEY);
		const [url, init] = fetchMock.mock.calls.at(-1)!;
		expect(url).toBe('/api/push/subscribe');
		expect(init.method).toBe('POST');
		expect(JSON.parse(init.body)).toMatchObject({ endpoint: 'https://push.example.net/push/abc' });
	});

	it('reuses an existing subscription instead of churning a new one', async () => {
		await setup({ permission: 'granted', existing: new FakeSubscription() });
		expect(await mod.enable_push(KEY)).toMatchObject({ ok: true });
		expect(subscribe).not.toHaveBeenCalled();
		expect(fetchMock).toHaveBeenCalled(); // still re-registers, which is idempotent
	});

	it('reports failure when the push service refuses to subscribe', async () => {
		await setup({ permission: 'granted' });
		subscribe.mockRejectedValue(new Error('AbortError'));
		expect(await mod.enable_push(KEY)).toMatchObject({ ok: false });
	});

	it('refuses on iOS until the app is installed', async () => {
		await setup({ ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4) Safari/605', standalone: false });
		expect(await mod.enable_push(KEY)).toMatchObject({ ok: false, reason: 'ios-needs-install' });
		expect(requestPermission).not.toHaveBeenCalled();
	});
});

describe('disable_push', () => {
	it('unsubscribes this device and tells the server to forget the endpoint', async () => {
		const sub = new FakeSubscription();
		await setup({ permission: 'granted', existing: sub });
		expect(await mod.disable_push()).toBe(true);
		expect(sub.unsubscribe).toHaveBeenCalled();
		const [url, init] = fetchMock.mock.calls.at(-1)!;
		expect(url).toBe('/api/push/unsubscribe');
		expect(JSON.parse(init.body)).toEqual({ endpoint: sub.endpoint });
	});

	it('is a no-op when this device was never subscribed', async () => {
		await setup({ permission: 'granted', existing: null });
		expect(await mod.disable_push()).toBe(false);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('still tells the server even if the local unsubscribe fails', async () => {
		const sub = new FakeSubscription();
		sub.unsubscribe.mockRejectedValue(new Error('nope'));
		await setup({ permission: 'granted', existing: sub });
		await mod.disable_push();
		expect(fetchMock.mock.calls.at(-1)![0]).toBe('/api/push/unsubscribe');
	});
});

describe('sync_subscription', () => {
	it('re-registers a live subscription, healing server-side loss', async () => {
		await setup({ permission: 'granted', existing: new FakeSubscription() });
		await mod.sync_subscription(KEY);
		expect(fetchMock.mock.calls.at(-1)![0]).toBe('/api/push/subscribe');
	});

	it('does nothing when the user has not enabled notifications', async () => {
		await setup({ permission: 'default', existing: null });
		await mod.sync_subscription(KEY);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('never prompts — it runs on load, where prompting is forbidden', async () => {
		await setup({ permission: 'granted', existing: new FakeSubscription() });
		await mod.sync_subscription(KEY);
		expect(requestPermission).not.toHaveBeenCalled();
	});
});
