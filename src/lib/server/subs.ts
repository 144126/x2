import { ensure, upsert, scroll, remove, uuid_from, f, eq, ZV, type QEnv } from './qdrant';
import type { WebPushSub } from './push';

export type PushSub = {
	s: 'ps';
	f: string;
	ep: string;
	k: string;
	au: string;
	ua?: string;
	d: number;
};

export async function save_sub(
	env: QEnv,
	uid: string,
	sub: WebPushSub,
	ua?: string
): Promise<void> {
	if (!sub.endpoint || !sub.keys?.p256dh || !sub.keys?.auth)
		throw new Error('invalid push subscription');
	if (!sub.endpoint.startsWith('https://')) throw new Error('push endpoint must be https');
	await ensure(env);
	const p: PushSub = {
		s: 'ps',
		f: uid,
		ep: sub.endpoint,
		k: sub.keys.p256dh,
		au: sub.keys.auth,
		...(ua ? { ua } : {}),
		d: Date.now()
	};
	await upsert(env, [
		{
			id: await uuid_from(sub.endpoint),
			vector: ZV,
			payload: p as unknown as Record<string, unknown>
		}
	]);
}

export async function list_subs(env: QEnv, uid: string): Promise<PushSub[]> {
	await ensure(env);
	const pts = await scroll(env, f(eq('s', 'ps'), eq('f', uid)), 1000);
	return pts.map((p) => p.payload as unknown as PushSub);
}

export async function list_subs_many(env: QEnv, uids: string[]): Promise<PushSub[]> {
	if (!uids.length) return [];
	const lists = await Promise.all(uids.map((uid) => list_subs(env, uid)));
	const by_endpoint = new Map<string, PushSub>();
	for (const list of lists) for (const s of list) by_endpoint.set(s.ep, s);
	return [...by_endpoint.values()];
}

export async function delete_sub(env: QEnv, endpoint: string): Promise<void> {
	await remove(env, [await uuid_from(endpoint)]);
}

export async function delete_subs(env: QEnv, endpoints: string[]): Promise<void> {
	if (!endpoints.length) return;
	await remove(env, await Promise.all(endpoints.map((e) => uuid_from(e))));
}

export function to_web_push(p: PushSub): WebPushSub {
	return { endpoint: p.ep, keys: { p256dh: p.k, auth: p.au } };
}
