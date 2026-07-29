import type { HubNs } from './relay';

/** how many presence checks one request may fan out to — bounds the subrequest budget */
export const MAX_CHECKS = 100;

/** uids from `body.uids` that currently have at least one open socket on their ChatHub */
export async function online(body: unknown, ns: HubNs): Promise<string[] | null> {
	if (!body || typeof body !== 'object') return null;
	const uids = (body as { uids?: unknown }).uids;
	if (!Array.isArray(uids)) return null;
	const batch = (uids as string[]).slice(0, MAX_CHECKS);
	if (!batch.length) return [];

	let failures = 0;
	const checked = await Promise.all(
		batch.map(async (uid) => {
			try {
				const stub = ns.get(ns.idFromName(uid));
				const res = await stub.fetch(new Request('https://dummy/check'));
				const data = (await res.json()) as { online?: boolean };
				return data?.online ? uid : null;
			} catch {
				// an unreachable hub means we cannot prove they're online — treat as offline
				failures++;
				return null;
			}
		})
	);

	// if most of the batch failed, "nobody's online" is a lie about our own outage, not a
	// true reading — signal the caller to fail open rather than confidently return an
	// (accidentally) empty result
	if (failures > batch.length / 2) return null;
	return checked.filter((u): u is string => u !== null);
}
