import type { QEnv } from './qdrant';
import { hub_mute, hub_unmute, hub_mutes } from './hub_client';

export interface Mute {
	s: 'mu';
	ow: string;
	tg: string;
	k: 'u' | 'r';
	until: number;
	d: number;
}

export async function mute(
	env: QEnv,
	ws: Fetcher,
	owner: string,
	target: string,
	kind: 'u' | 'r',
	until = 0
): Promise<Mute> {
	await hub_mute(env, ws, owner, target, kind, until);
	return { s: 'mu', ow: owner, tg: target, k: kind, until, d: Date.now() };
}

export async function unmute(env: QEnv, ws: Fetcher, owner: string, target: string): Promise<void> {
	await hub_unmute(env, ws, owner, target);
}

/** every currently-active mute the owner has set, from their own ChatHub */
export async function list_mutes(env: QEnv, ws: Fetcher, owner: string): Promise<Mute[]> {
	const raw = await hub_mutes(env, ws, owner);
	return raw.map((m) => ({ s: 'mu', ow: owner, tg: m.tg, k: m.k, until: m.until, d: 0 }));
}

export async function is_muted(
	env: QEnv,
	ws: Fetcher,
	owner: string,
	target: string
): Promise<boolean> {
	const mutes = await list_mutes(env, ws, owner);
	return mutes.some((m) => m.tg === target);
}
