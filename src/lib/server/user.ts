import type { User } from '$lib/types';
import { ZV, ensure, upsert, retrieve_one, uuid_from, type QEnv } from './qdrant';
import { hash_pw, verify_pw } from './pw';

export async function save_user(
	env: QEnv,
	sub: string,
	name: string,
	picture?: string,
	email?: string,
	provider: 'google' | 'local' = 'google'
): Promise<string> {
	await ensure(env);
	const id = await uuid_from(sub);
	const c = await get_user(env, id);
	const u: User = {
		s: 'u',
		g: sub,
		n: name,
		p: picture,
		m: email,
		d: c?.d ?? Date.now(),
		o: provider,
		h: c?.h
	};
	await upsert(env, [{ id, vector: ZV, payload: u as unknown as Record<string, unknown> }]);
	return id;
}

export async function get_user(env: QEnv, id: string): Promise<User | null> {
	const u = (await retrieve_one(env, id))?.payload as unknown as User | undefined;
	return u?.s === 'u' ? u : null;
}

export async function create_pw_user(env: QEnv, email: string, password: string): Promise<string> {
	await ensure(env);
	const h = await hash_pw(password);
	const id = await uuid_from(email);
	const c = await get_user(env, id);
	const u: User = {
		s: 'u',
		g: email,
		n: email,
		m: email,
		d: c?.d ?? Date.now(),
		o: 'local',
		h
	};
	await upsert(env, [{ id, vector: ZV, payload: u as unknown as Record<string, unknown> }]);
	return id;
}

export async function verify_user_pw(env: QEnv, email: string, password: string): Promise<User | null> {
	const u = await get_user(env, await uuid_from(email));
	if (!u || u.o !== 'local' || !u.h) return null;
	return (await verify_pw(password, u.h)) ? u : null;
}
