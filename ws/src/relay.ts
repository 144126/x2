export type HubNs = {
	idFromName(n: string): unknown;
	get(id: unknown): { fetch(r: Request): Promise<Response> };
};

export async function relay(
	body: unknown,
	ns: HubNs
): Promise<null | { ok: boolean; undelivered: string[] }> {
	if (!body || typeof body !== 'object') return null;
	const b = body as Record<string, unknown>;
	const to = typeof b.to === 'string' ? b.to : undefined;
	const members = Array.isArray(b.members) ? (b.members as string[]) : undefined;
	const targets = to ? [to] : (members ?? []);
	if (!targets.length) return null;

	const undelivered: string[] = [];
	let any_ok = false;

	await Promise.all(
		targets.map(async (uid) => {
			try {
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
				if (!data || typeof data.delivered !== 'boolean' || !data.delivered) undelivered.push(uid);
			} catch {
				undelivered.push(uid);
			}
		})
	);

	return { ok: any_ok, undelivered };
}
