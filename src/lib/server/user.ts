import type { User } from '../types';
export type { User }; // re-export so device.ts can type its returns
import {
	ensure,
	upsert,
	retrieve_one,
	retrieve_many,
	uuid_from,
	scroll,
	f,
	f_or,
	eq,
	type QEnv
} from './qdrant';
import { validate_username, available_username } from './username';
import { hash_pw, verify_pw } from './pw';

// Identity is the username, derived once from the email local-part. Google's display
// name is deliberately never requested or stored — the user edits their username instead.
async function claim_username(
	env: QEnv,
	id: string,
	from: string,
	existing?: User
): Promise<string> {
	if (existing?.u && validate_username(existing.u)) return existing.u;
	return available_username(env, from, id);
}

export async function save_user(
	env: QEnv,
	sub: string,
	picture?: string,
	email?: string,
	provider: 'google' | 'local' | 'device' = 'google'
): Promise<string> {
	await ensure(env);
	const id = await uuid_from(sub);
	const pt = await retrieve_one(env, id, true);
	const prev = pt?.payload as unknown as User | undefined;
	const existing = prev?.s === 'u' ? prev : undefined;
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
	await upsert(env, [
		{ id, vector: pt?.vector ?? {}, payload: u as unknown as Record<string, unknown> }
	]);
	return id;
}

export async function get_user(env: QEnv, id: string): Promise<User | null> {
	const p = (await retrieve_one(env, id))?.payload as unknown as User | undefined;
	return p?.s === 'u' ? p : null;
}

export function is_device_only(u: Pick<User, 'h' | 'o'>): boolean {
	return !u.h && u.o !== 'google';
}

export async function find_user_by_email(
	env: QEnv,
	email: string
): Promise<(User & { id: string }) | null> {
	await ensure(env);
	const pts = await scroll(env, f(eq('s', 'u'), eq('m', email)), 1);
	const p = pts[0];
	return p ? { ...(p.payload as unknown as User), id: String(p.id) } : null;
}

export async function find_user_by_google_sub(
	env: QEnv,
	sub: string
): Promise<(User & { id: string }) | null> {
	await ensure(env);
	const pts = await scroll(env, f_or([eq('s', 'u')], [eq('g', sub), eq('gl', sub)]), 1);
	const p = pts[0];
	return p ? { ...(p.payload as unknown as User), id: String(p.id) } : null;
}

/** merges `patch` onto a user's record, preserving their existing search embedding */
export async function patch_user(
	env: QEnv,
	uid: string,
	patch: Partial<User>
): Promise<User | null> {
	await ensure(env);
	const pt = await retrieve_one(env, uid, true);
	const cur = pt?.payload as unknown as User | undefined;
	if (!cur || cur.s !== 'u') return null;
	const merged: User = { ...cur, ...patch };
	await upsert(env, [
		{
			id: uid,
			vector: pt!.vector ?? {},
			payload: merged as unknown as Record<string, unknown>
		}
	]);
	return merged;
}

export async function create_pw_user(env: QEnv, email: string, password: string): Promise<string> {
	await ensure(env);
	const id = await uuid_from(email);
	const pt = await retrieve_one(env, id, true);
	const prev = pt?.payload as unknown as User | undefined;
	const existing = prev?.s === 'u' ? prev : undefined;
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
	await upsert(env, [
		{ id, vector: pt?.vector ?? {}, payload: u as unknown as Record<string, unknown> }
	]);
	return id;
}

export async function verify_user_pw(
	env: QEnv,
	email: string,
	password: string
): Promise<(User & { id: string }) | null> {
	const found = await find_user_by_email(env, email);
	const id = found ? found.id : await uuid_from(email);
	const u = found ?? (await get_user(env, id));
	if (!u || u.o !== 'local' || !u.h) return null;
	return (await verify_pw(password, u.h)) ? { ...u, id } : null;
}

/** username for display — the only user-facing identity. */
export async function get_user_name(env: QEnv, uid: string): Promise<string> {
	return (await get_user(env, uid))?.u ?? uid;
}

export async function get_user_names(env: QEnv, ids: string[]): Promise<Record<string, string>> {
	const pts = await retrieve_many(env, [...new Set(ids)]);
	const out: Record<string, string> = {};
	for (const p of pts) {
		const u = p.payload as unknown as User;
		if (u?.s === 'u') out[String(p.id)] = u.u ?? String(p.id);
	}
	for (const id of ids) out[id] ??= id;
	return out;
}
