// Offline outbox: queues sends that fail while offline, drained on reconnect via
// Background Sync (falls back to an `online` listener where Background Sync is unsupported).

export type Outgoing = { id: string; at: number; tries: number; body: Record<string, unknown> };
export type OutStore = {
	all(): Promise<Outgoing[]>;
	put(o: Outgoing): Promise<void>;
	del(id: string): Promise<void>;
};

export const MAX_TRIES = 5;

export async function queue(
	store: OutStore,
	body: Record<string, unknown>,
	at: number = Date.now()
): Promise<Outgoing> {
	const o: Outgoing = { id: crypto.randomUUID(), at, tries: 0, body };
	await store.put(o);
	return o;
}

export async function drain(
	store: OutStore,
	post: (body: never) => Promise<boolean>
): Promise<{ sent: number; kept: number; dropped: number }> {
	const rows = await store.all();
	let sent = 0;
	let kept = 0;
	let dropped = 0;

	for (const o of rows) {
		let ok: boolean;
		try {
			ok = await post(o.body as never);
		} catch {
			ok = false;
		}
		if (ok) {
			await store.del(o.id);
			sent++;
			continue;
		}
		const tries = o.tries + 1;
		if (tries >= MAX_TRIES) {
			await store.del(o.id);
			dropped++;
		} else {
			await store.put({ ...o, tries });
			kept++;
		}
	}

	return { sent, kept, dropped };
}
