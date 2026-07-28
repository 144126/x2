// App icon badging (navigator.setAppBadge) — Safari/Chrome desktop & Android home screen.

type Badgeable = Navigator & {
	setAppBadge?(n?: number): Promise<void>;
	clearAppBadge?(): Promise<void>;
};

export async function set_badge(n: number): Promise<void> {
	const nav = navigator as Badgeable;
	try {
		if (n <= 0) await nav.clearAppBadge?.();
		else await nav.setAppBadge?.(n);
	} catch {
		/* unsupported or denied — badging is cosmetic */
	}
}

export async function sync_badge(): Promise<number> {
	try {
		const res = await fetch('/api/read');
		const { total } = (await res.json()) as { total: number };
		await set_badge(total);
		return total;
	} catch {
		return 0;
	}
}
