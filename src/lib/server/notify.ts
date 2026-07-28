import { get_secret, type QEnv } from './qdrant';
import { list_subs_many, delete_subs, to_web_push } from './subs';
import { send_push, clamp_payload, push_topic, type PushKeys } from './push';

type NotifyEnv = QEnv & {
	VAPID_PUBLIC?: string;
	VAPID_PRIVATE?: string;
	VAPID_SUBJECT?: string;
};

export async function notify(
	env: NotifyEnv,
	uids: string[],
	payload: Record<string, unknown>
): Promise<{ sent: number; pruned: number }> {
	if (!uids.length) return { sent: 0, pruned: 0 };

	const pub = await get_secret(env.VAPID_PUBLIC);
	const priv = await get_secret(env.VAPID_PRIVATE);
	const subject = await get_secret(env.VAPID_SUBJECT);
	if (!pub || !priv || !subject) return { sent: 0, pruned: 0 };
	const keys: PushKeys = { public: pub, private: priv, subject };

	try {
		const subs = await list_subs_many(env, uids);
		if (!subs.length) return { sent: 0, pruned: 0 };

		const body = clamp_payload(payload);
		const conv = typeof payload.conv === 'string' ? payload.conv : undefined;
		const opts = conv ? { topic: push_topic(conv) } : {};

		const results = await Promise.all(
			subs.map((s) => send_push(to_web_push(s), body, keys, opts))
		);

		const gone = subs.filter((_, i) => results[i].gone).map((s) => s.ep);
		if (gone.length) await delete_subs(env, gone);

		return { sent: results.filter((r) => r.ok).length, pruned: gone.length };
	} catch {
		return { sent: 0, pruned: 0 };
	}
}
