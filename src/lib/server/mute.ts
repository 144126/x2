import {
	ensure,
	upsert,
	scroll,
	remove,
	uuid_from,
	f,
	eq,
	type QEnv,
	type Cond
} from './qdrant';
import { conv_id, group_conv_id } from './chat';

export interface Mute {
	s: 'mu';
	ow: string;
	tg: string;
	k: 'u' | 'r';
	until: number;
	d: number;
}

const mute_id = (owner: string, target: string) => uuid_from(`mute:${owner}:${target}`);

export const is_active = (m: Mute, now = Date.now()): boolean => m.until === 0 || m.until > now;

export async function mute(
	env: QEnv,
	owner: string,
	target: string,
	kind: 'u' | 'r',
	until = 0
): Promise<Mute> {
	await ensure(env);
	const m: Mute = { s: 'mu', ow: owner, tg: target, k: kind, until, d: Date.now() };
	await upsert(env, [
		{
			id: await mute_id(owner, target),
			vector: {},
			payload: m as unknown as Record<string, unknown>
		}
	]);
	return m;
}

export async function unmute(env: QEnv, owner: string, target: string): Promise<void> {
	await ensure(env);
	await remove(env, [await mute_id(owner, target)]);
}

export async function list_mutes(env: QEnv, owner: string, now = Date.now()): Promise<Mute[]> {
	await ensure(env);
	const pts = await scroll(env, f(eq('s', 'mu'), eq('ow', owner)), 500);
	return pts.map((p) => p.payload as unknown as Mute).filter((m) => is_active(m, now));
}

export async function is_muted(
	env: QEnv,
	owner: string,
	target: string,
	now = Date.now()
): Promise<boolean> {
	await ensure(env);
	const pts = await scroll(env, f(eq('s', 'mu'), eq('ow', owner), eq('tg', target)), 1);
	const m = pts[0]?.payload as unknown as Mute | undefined;
	return !!m && is_active(m, now);
}

export async function muters_of(
	env: QEnv,
	target: string,
	uids: string[],
	now = Date.now()
): Promise<Set<string>> {
	if (!uids.length) return new Set();
	await ensure(env);
	const pts = await scroll(env, f(eq('s', 'mu'), eq('tg', target)), 1000);
	const candidates = new Set(uids);
	return new Set(
		pts
			.map((p) => p.payload as unknown as Mute)
			.filter((m) => is_active(m, now) && candidates.has(m.ow))
			.map((m) => m.ow)
	);
}

export async function drop_muted(
	env: QEnv,
	target: string,
	uids: string[],
	now = Date.now()
): Promise<string[]> {
	const muted = await muters_of(env, target, uids, now);
	return uids.filter((u) => !muted.has(u));
}

export function muted_convs(uid: string, mutes: Mute[]): string[] {
	return mutes.map((m) => (m.k === 'r' ? group_conv_id(m.tg) : conv_id(uid, m.tg)));
}
