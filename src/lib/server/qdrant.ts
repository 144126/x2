import { QdrantClient } from '@qdrant/js-client-rest';

export type SecretVal = string | { get?: () => Promise<string> } | undefined;

// Reads a Secrets Store binding or a plain string. `fallback` covers local dev, where a
// secrets_store_secrets binding exists but the local store is empty, so .get() throws
// `Secret "X" not found` — .dev.vars cannot override a store binding, so callers pass a
// separately-named plain var instead.
export async function get_secret(v: SecretVal, fallback?: SecretVal): Promise<string> {
	if (v && typeof (v as { get?: unknown }).get === 'function') {
		try {
			const s = await (v as { get: () => Promise<string> }).get();
			if (s) return s;
		} catch {
			/* empty local store — fall through */
		}
	} else if (typeof v === 'string' && v) return v;
	return fallback ? await get_secret(fallback) : '';
}

export const b64u = (buf: ArrayBuffer | Uint8Array): string => {
	const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
	let s = '';
	for (const b of bytes) s += String.fromCharCode(b);
	return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
export const unb64u = (s: string): Uint8Array => {
	const t = s.replace(/-/g, '+').replace(/_/g, '/');
	const bin = atob(t.padEnd(Math.ceil(t.length / 4) * 4, '='));
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
};

let q: QdrantClient | null = null;
let q_key = '';

export async function qc(env: QEnv): Promise<QdrantClient> {
	const url = await get_secret(env.QDRANT_URL, env.DEV_QDRANT_URL);
	const key = await get_secret(env.QDRANT_KEY, env.DEV_QDRANT_KEY);
	if (!q || q_key !== key)
		q = new QdrantClient({ url, apiKey: key, checkCompatibility: false });
	q_key = key;
	return q;
}

export const ZV: number[] = new Array(4096).fill(0);
export const C = 'x2';

export type QEnv = {
	QDRANT_URL: SecretVal;
	QDRANT_KEY: SecretVal;
	VOXELL_KEY?: SecretVal;
	// local dev only (ws/.dev.vars): the ws worker's Secrets Store is empty there
	DEV_QDRANT_URL?: SecretVal;
	DEV_QDRANT_KEY?: SecretVal;
};


// deterministic UUID from an external id (e.g. google sub)
export async function uuid_from(s: string): Promise<string> {
	const h = new Uint8Array(
		await crypto.subtle.digest('SHA-256', new TextEncoder().encode('x2:' + s))
	);
	const x = [...h.slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('');
	return `${x.slice(0, 8)}-${x.slice(8, 12)}-4${x.slice(13, 16)}-8${x.slice(17, 20)}-${x.slice(20, 32)}`;
}

export const new_id = (): string => crypto.randomUUID();

// filter helpers: eq('s','o'), f(eq('s','o'), eq('j', id))
export type Cond =
	| { key: string; match: { value: string | number } }
	| { key: string; range: { gte?: number; lte?: number } };
export const eq = (key: string, value: string | number): Cond => ({ key, match: { value } });
export const range = (key: string, gte?: number, lte?: number): Cond => ({
	key,
	range: { ...(gte !== undefined ? { gte } : {}), ...(lte !== undefined ? { lte } : {}) }
});
export const f = (...conds: Cond[]) => ({ must: conds });

type Pt = { id: string | number; vector?: number[]; payload: Record<string, unknown> | null; score?: number };

// idempotent: create collection + payload indexes if missing (once per instance)
// Qdrant strict_mode on this collection rejects filtering on any unindexed field, so every
// key ever used in a filter (eq/range) below MUST be indexed here.
let ensured = false;
export async function ensure(env: QEnv): Promise<void> {
	if (ensured) return;
	const c = await qc(env);
	await c
		.createCollection(C, { vectors: { size: 4096, distance: 'Cosine' } })
		.catch(() => {});
	for (const key of ['s', 't', 'r', 'c', 'f', 'co', 'st', 'u', 'ow', 'mb', 'gr'])
		await c.createPayloadIndex(C, { field_name: key, field_schema: 'keyword' }).catch(() => {});
	await c.createPayloadIndex(C, { field_name: 'ag', field_schema: 'integer' }).catch(() => {});
	ensured = true;
}

export async function scroll(
	env: QEnv,
	filter: ReturnType<typeof f>,
	limit = 1000
): Promise<Pt[]> {
	const r = await (await qc(env))
		.scroll(C, { filter, limit, with_payload: true, with_vector: false })
		.catch(() => ({ points: [] as Pt[] }));
	return r.points as Pt[];
}

export async function retrieve_one(env: QEnv, id: string, with_vector = false): Promise<Pt | null> {
	const r = await (await qc(env)).retrieve(C, { ids: [id], with_vector }).catch(() => []);
	return (r[0] as Pt) ?? null;
}

export async function search(
	env: QEnv,
	vector: number[],
	filter: ReturnType<typeof f>,
	limit = 12
): Promise<Pt[]> {
	const r = await (await qc(env))
		.search(C, { vector, filter, limit, with_payload: true })
		.catch(() => []);
	return r as unknown as Pt[];
}

export async function upsert(env: QEnv, points: Pt[]): Promise<void> {
	if (!points.length) return;
	await (await qc(env))
		.upsert(C, { points: points as unknown as { id: string | number; vector: number[]; payload: Record<string, unknown> }[] })
		.catch(() => {});
}
