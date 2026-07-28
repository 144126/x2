// PWA install-prompt capture (`beforeinstallprompt`) + iOS "add to home screen" hinting.

type BIPEvent = Event & {
	prompt(): Promise<void>;
	userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

const KEY = 'x2:install-dismissed-at';
export const REASK_MS = 14 * 24 * 60 * 60 * 1000;

let deferred: BIPEvent | null = null;

export function can_install(): boolean {
	return deferred !== null;
}

export function watch_install(): () => void {
	const on_prompt = (e: Event) => {
		e.preventDefault();
		deferred = e as BIPEvent;
	};
	const on_installed = () => {
		deferred = null;
	};
	window.addEventListener('beforeinstallprompt', on_prompt);
	window.addEventListener('appinstalled', on_installed);
	return () => {
		window.removeEventListener('beforeinstallprompt', on_prompt);
		window.removeEventListener('appinstalled', on_installed);
	};
}

export async function install(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
	if (!deferred) return 'unavailable';
	const e = deferred;
	deferred = null;
	await e.prompt();
	const { outcome } = await e.userChoice;
	return outcome;
}

export function dismiss_install(now: number = Date.now()): void {
	try {
		localStorage.setItem(KEY, String(now));
	} catch {
		/* private browsing */
	}
}

export function install_hidden(now: number = Date.now()): boolean {
	try {
		const at = Number(localStorage.getItem(KEY));
		return Number.isFinite(at) && at > 0 && now - at < REASK_MS;
	} catch {
		return false;
	}
}

function is_ios(): boolean {
	return /iPhone|iPad|iPod|Macintosh.*Mobile/.test(navigator.userAgent) && /iPhone|iPad|iPod/.test(navigator.userAgent);
}

function is_standalone(): boolean {
	return (
		('standalone' in navigator && (navigator as unknown as { standalone?: boolean }).standalone === true) ||
		window.matchMedia?.('(display-mode: standalone)').matches === true
	);
}

export function ios_hint_needed(): boolean {
	return is_ios() && !is_standalone();
}
