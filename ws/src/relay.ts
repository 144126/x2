export type HubNs = {
	idFromName(n: string): unknown;
	get(id: unknown): { fetch(r: Request): Promise<Response> };
};

export async function relay(
	body: unknown,
	ns: HubNs
): Promise<null | { ok: boolean; undelivered: string[] }> {
	console.log('[RELAY] called with body:', body);
	if (!body || typeof body !== 'object') {
		console.warn('[RELAY] body is not an object, returning null');
		return null;
	}
	const b = body as Record<string, unknown>;
	const to = typeof b.to === 'string' ? b.to : undefined;
	const members = Array.isArray(b.members) ? (b.members as string[]) : undefined;
	const targets = to ? [to] : (members ?? []);
	console.log('[RELAY] resolved targets:', targets);
	if (!targets.length) {
		console.warn('[RELAY] no targets, returning null');
		return null;
	}

	const undelivered: string[] = [];
	let any_ok = false;

	await Promise.all(
		targets.map(async (uid) => {
			try {
				console.log(`[RELAY] forwarding to ChatHub DO for uid=${uid}`);
				const stub = ns.get(ns.idFromName(uid));
				const res = await stub.fetch(
					new Request('https://dummy/relay', {
						method: 'POST',
						headers: { 'content-type': 'application/json' },
						body: JSON.stringify({ ...b, to: uid })
					})
				);
				any_ok = true;
				const data = (await res.json().catch(() => null)) as { delivered?: boolean } | null;
				console.log(`[RELAY] uid=${uid} DO responded:`, data);
				if (!data || typeof data.delivered !== 'boolean' || !data.delivered) undelivered.push(uid);
			} catch (e) {
				console.error(`[RELAY] uid=${uid} DO fetch THREW:`, e);
				undelivered.push(uid);
			}
		})
	);

	console.log('[RELAY] final result:', { ok: any_ok, undelivered });
	return { ok: any_ok, undelivered };
}
