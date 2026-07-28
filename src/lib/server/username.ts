import { f, eq, scroll, type QEnv } from './qdrant';

const USERNAME = /^[a-z0-9_]{3,20}$/;

/** email local-part (or any string) → a legal username. Never throws. */
export function normalize_username(value: string): string {
	const cleaned = value
		.toLowerCase()
		.split('@')[0]
		.replace(/[^a-z0-9_]+/g, '_')
		.replace(/^_+|_+$/g, '');
	return (cleaned || 'user').slice(0, 20).padEnd(3, '0');
}

export function validate_username(value: string): string | null {
	return USERNAME.test(value) ? value : null;
}

/** true when nobody except `self` holds this username. */
export async function username_free(env: QEnv, name: string, self?: string): Promise<boolean> {
	const held = await scroll(env, f(eq('s', 'u'), eq('u', name)), 2);
	return held.every((p) => String(p.id) === self);
}

/**
 * `base` if free, else base2, base3… — the suffix eats into the 20-char budget so the
 * result stays legal. `self` is the uid claiming it, so re-saving your own name is fine.
 */
export async function available_username(env: QEnv, base: string, self?: string): Promise<string> {
	const b = normalize_username(base);
	for (let n = 1; n < 500; n++) {
		const candidate = n === 1 ? b : `${b.slice(0, 20 - String(n).length)}${n}`;
		if (validate_username(candidate) && (await username_free(env, candidate, self))) return candidate;
	}
	// ponytail: 500 collisions on one base is not a real scenario; uid suffix ends it
	return `${b.slice(0, 12)}_${(self ?? 'x').slice(0, 6)}`;
}
