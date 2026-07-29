import type { User } from '../types';
import { ensure, upsert, retrieve_one, uuid_from, ZV, type QEnv } from './qdrant';
import { validate_username, available_username } from './username';
import { hash_pw, verify_pw } from './pw';

// Identity is the username, derived once from the email local-part. Google's display
// name is deliberately never requested or stored — the user edits their username instead.
async function claim_username(env: QEnv, id: string, from: string, existing?: User): Promise<string> {
	if (existing?.u && validate_username(existing.u)) return existing.u;
	return available_username(env, from, id);
}

export async function save_user(
	env: QEnv,
	sub: string,
	picture?: string,
	email?: string,
	provider: 'google' | 'local' = 'google'
): Promise<string> {
	await ensure(env);
	const id = await uuid_from(sub);
	const existing = (await get_user(env, id)) ?? undefined;
	const u: User = {
		...existing,
		s: 'u',
		g: sub,
		p: picture ?? existing?.p,
		m: email ?? existing?.m,
		u: await claim_username(env, id, email ?? sub, existing),
		d: existing?.d ?? Date.now(),
		o: existing?.o ?? provider,
		h: existing?.h
	};
	await upsert(env, [{ id, vector: ZV, payload: u as unknown as Record<string, unknown> }]);
	return id;
}

export async function get_user(env: QEnv, id: string): Promise<User | null> {
	const p = (await retrieve_one(env, id))?.payload as unknown as User | undefined;
	return p?.s === 'u' ? p : null;
}

/** merges `patch` onto a user's record, preserving their existing search embedding */
export async function patch_user(env: QEnv, uid: string, patch: Partial<User>): Promise<User | null> {
	await ensure(env);
	const pt = await retrieve_one(env, uid, true);
	const cur = pt?.payload as unknown as User | undefined;
	if (!cur || cur.s !== 'u') return null;
	const merged: User = { ...cur, ...patch };
	await upsert(env, [
		{ id: uid, vector: (pt!.vector as number[]) ?? ZV, payload: merged as unknown as Record<string, unknown> }
	]);
	return merged;
}

export async function create_pw_user(env: QEnv, email: string, password: string): Promise<string> {
	await ensure(env);
	const id = await uuid_from(email);
	const existing = (await get_user(env, id)) ?? undefined;
	const u: User = {
		...existing,
		s: 'u',
		g: email,
		m: email,
		u: await claim_username(env, id, email, existing),
		d: existing?.d ?? Date.now(),
		o: 'local',
		h: await hash_pw(password)
	};
	await upsert(env, [{ id, vector: ZV, payload: u as unknown as Record<string, unknown> }]);
	return id;
}

export async function verify_user_pw(env: QEnv, email: string, password: string): Promise<User | null> {
	const u = await get_user(env, await uuid_from(email));
	if (!u || u.o !== 'local' || !u.h) return null;
	return (await verify_pw(password, u.h)) ? u : null;
}

/** username for display — the only user-facing identity. */
export async function get_user_name(env: QEnv, uid: string): Promise<string> {
	return (await get_user(env, uid))?.u ?? uid;
}
