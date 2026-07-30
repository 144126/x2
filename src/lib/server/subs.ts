import type { QEnv } from './qdrant';
import { hub_sub, hub_unsub } from './hub_client';
import type { WebPushSub } from './push';

export async function save_sub(
	env: QEnv,
	ws: Fetcher,
	uid: string,
	sub: WebPushSub,
	ua?: string
): Promise<void> {
	if (!sub.endpoint || !sub.keys?.p256dh || !sub.keys?.auth)
		throw new Error('invalid push subscription');
	if (!sub.endpoint.startsWith('https://')) throw new Error('push endpoint must be https');
	await hub_sub(env, ws, uid, sub, ua);
}

export async function delete_sub(
	env: QEnv,
	ws: Fetcher,
	uid: string,
	endpoint: string
): Promise<void> {
	await hub_unsub(env, ws, uid, endpoint);
}
