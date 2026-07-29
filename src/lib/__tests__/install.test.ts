import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

type Listener = (e: unknown) => void;

let listeners: Record<string, Listener[]>;
let store: Record<string, string>;
let mod: typeof import('../install');

const fire = (type: string, e: unknown = {}) => listeners[type]?.forEach((fn) => fn(e));

const bip = () => ({
	preventDefault: vi.fn(),
	prompt: vi.fn().mockResolvedValue(undefined),
	userChoice: Promise.resolve({ outcome: 'accepted' as const })
});

async function setup(ua = 'Mozilla/5.0 (X11; Linux) Chrome/140', standalone = false) {
	listeners = {};
	store = {};
	vi.stubGlobal('window', {
		addEventListener: (t: string, fn: Listener) => (listeners[t] ??= []).push(fn),
		removeEventListener: (t: string, fn: Listener) => {
			listeners[t] = (listeners[t] ?? []).filter((f) => f !== fn);
		},
		matchMedia: (q: string) => ({ matches: standalone && q.includes('standalone') })
	});
	vi.stubGlobal('navigator', { userAgent: ua, ...(standalone ? { standalone: true } : {}) });
	vi.stubGlobal('localStorage', {
		getItem: (k: string) => store[k] ?? null,
		setItem: (k: string, v: string) => (store[k] = v),
		removeItem: (k: string) => delete store[k]
	});
	vi.resetModules();
	mod = await import('../install');
}

beforeEach(() => setup());
afterEach(() => vi.unstubAllGlobals());

describe('watch_install', () => {
	it('cannot install before the browser says the app qualifies', () => {
		mod.watch_install();
		expect(mod.can_install()).toBe(false);
	});

	it('suppresses the browser mini-infobar so the app can place its own prompt', () => {
		mod.watch_install();
		const e = bip();
		fire('beforeinstallprompt', e);
		expect(e.preventDefault).toHaveBeenCalled();
	});

	it('can install once the event has fired', () => {
		mod.watch_install();
		fire('beforeinstallprompt', bip());
		expect(mod.can_install()).toBe(true);
	});

	it('stops offering to install once the app is installed', () => {
		mod.watch_install();
		fire('beforeinstallprompt', bip());
		fire('appinstalled');
		expect(mod.can_install()).toBe(false);
	});

	it('detaches its listeners when torn down', () => {
		const off = mod.watch_install();
		off();
		fire('beforeinstallprompt', bip());
		expect(mod.can_install()).toBe(false);
	});
});

describe('install', () => {
	it('reports unavailable when there is no captured prompt', async () => {
		mod.watch_install();
		expect(await mod.install()).toBe('unavailable');
	});

	it('shows the browser prompt and reports acceptance', async () => {
		mod.watch_install();
		const e = bip();
		fire('beforeinstallprompt', e);
		expect(await mod.install()).toBe('accepted');
		expect(e.prompt).toHaveBeenCalled();
	});

	it('reports a dismissal', async () => {
		mod.watch_install();
		const e = { ...bip(), userChoice: Promise.resolve({ outcome: 'dismissed' as const }) };
		fire('beforeinstallprompt', e);
		expect(await mod.install()).toBe('dismissed');
	});

	it('consumes the prompt — the event can only be used once', async () => {
		mod.watch_install();
		fire('beforeinstallprompt', bip());
		await mod.install();
		expect(mod.can_install()).toBe(false);
	});
});

describe('dismissal memory', () => {
	const now = 1_800_000_000_000;

	it('shows the banner to someone who has never dismissed it', () => {
		expect(mod.install_hidden(now)).toBe(false);
	});

	it('hides the banner right after a dismissal', () => {
		mod.dismiss_install(now);
		expect(mod.install_hidden(now)).toBe(true);
	});

	it('stays hidden for the whole re-ask window', () => {
		mod.dismiss_install(now);
		expect(mod.install_hidden(now + mod.REASK_MS - 1)).toBe(true);
	});

	it('comes back after the re-ask window, rather than never asking again', () => {
		mod.dismiss_install(now);
		expect(mod.install_hidden(now + mod.REASK_MS + 1)).toBe(false);
	});

	it('survives storage being unavailable, as in private browsing', async () => {
		vi.stubGlobal('localStorage', {
			getItem: () => {
				throw new Error('denied');
			},
			setItem: () => {
				throw new Error('denied');
			}
		});
		expect(() => mod.dismiss_install(now)).not.toThrow();
		expect(mod.install_hidden(now)).toBe(false);
	});
});

describe('ios_hint_needed', () => {
	it('is false on a browser with a real install prompt', () => {
		expect(mod.ios_hint_needed()).toBe(false);
	});

	it('is true on iOS Safari in a tab — the only way in is Share → Add to Home Screen', async () => {
		await setup('Mozilla/5.0 (iPhone; CPU iPhone OS 17_4) Safari/605', false);
		expect(mod.ios_hint_needed()).toBe(true);
	});

	it('is false once the app already runs standalone on iOS', async () => {
		await setup('Mozilla/5.0 (iPhone; CPU iPhone OS 17_4) Safari/605', true);
		expect(mod.ios_hint_needed()).toBe(false);
	});

	it('covers iPad, which reports as Macintosh with touch', async () => {
		await setup('Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) Safari/605', false);
		expect(mod.ios_hint_needed()).toBe(true);
	});
});
