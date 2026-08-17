import type { Message } from '../types';
import { get_group } from './group';
import type { QEnv } from './qdrant';

/**
 * Fans one message event out to everyone in the thread. Reactions, deletes and view-once
 * burns all need the same audience, and each route working it out again is how one of them
 * ends up quietly telling nobody.
 */
export async function audience(env: QEnv, m: Message, except?: string): Promise<string[]> {
	const all = m.gr ? ((await get_group(env, m.gr))?.members ?? []) : [m.f, m.t];
	return [...new Set(all)].filter((u) => u && u !== except);
}

export async function relay_to(
	ws: Fetcher,
	targets: string[],
	payload: Record<string, unknown>
): Promise<void> {
	if (!targets.length) return;
	await ws
		.fetch('https://x2-ws/relay', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ ...payload, members: targets })
		})
		.catch((e) => console.error('[RELAY] message event failed', e));
}
