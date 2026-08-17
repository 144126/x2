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

export { b64u, unb64u } from '../b64';

let q: QdrantClient | null = null;
let q_key = '';
let creds: Promise<{ url: string; key: string }> | null = null;
let ensuring: Promise<void> | null = null;

export async function qc(env: QEnv): Promise<QdrantClient> {
	creds ??= (async () => ({
		url: await get_secret(env.QDRANT_URL, env.DEV_QDRANT_URL),
		key: await get_secret(env.QDRANT_KEY, env.DEV_QDRANT_KEY)
	}))();
	const { url, key } = await creds;
	if (!q || q_key !== key) {
		q = new QdrantClient({ url, apiKey: key, checkCompatibility: false });
		q_key = key;
	}
	return q;
}

export function __reset_qdrant(): void {
	q = null;
	q_key = '';
	creds = null;
	ensuring = null;
}

export const ZV: number[] = new Array(4096).fill(0);
// alias -> the physical named-vector collection `x2v2` (see named_vector_migration and
// scripts/migrate-named-vectors.mjs). The old unnamed-vector collection `x2` still exists,
// untouched, until a verified deploy against this alias — do not drop it before then.
export const C = 'x2live';
// the collection's single named dense vector — a point may omit it (`vector: {}`) at zero
// storage/index cost, which is why it exists: see named_vector_migration.
export const V = 't';

export type QEnv = {
	QDRANT_URL: SecretVal;
	QDRANT_KEY: SecretVal;
	SECRET?: SecretVal;
	// local dev fallback shared with the ws worker (ws/.env DEV_SECRET) — the ws worker's
	// Secrets Store is empty locally, so it validates bearer tokens against this instead
	DEV_SECRET?: SecretVal;
	VOXELL_KEY?: SecretVal;
	MESSAGE_ENC_KEY?: SecretVal;
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
// AND every `musts`, but require at least one of `any_of` too (Qdrant's must+should combo)
export const f_or = (musts: Cond[], any_of: Cond[]) => ({ must: musts, should: any_of });
// AND every `musts` while excluding any `nots` (Qdrant's must+must_not combo)
export const f_not = (musts: Cond[], nots: Cond[]) => ({ must: musts, must_not: nots });

export type Filter = ReturnType<typeof f> | ReturnType<typeof f_or> | ReturnType<typeof f_not>;

type Pt = {
	id: string | number;
	vector?: number[] | Record<string, number[]>;
	payload: Record<string, unknown> | null;
	score?: number;
};

const KEYWORD_KEYS = [
	's',
	't',
	'r',
	'c',
	'f',
	'co',
	'st',
	'ci',
	'u',
	'ow',
	'mb',
	'gr',
	'uid',
	'ac',
	'tg',
	'k',
	'rs',
	'm',
	'gl',
	'pr'
] as const;
const INT_KEYS = ['ag', 'at', 'sent', 'd'] as const;

export function ensure(env: QEnv): Promise<void> {
	return (ensuring ??= provision(env).catch(() => {
		ensuring = null;
	}));
}

async function provision(env: QEnv): Promise<void> {
	const c = await qc(env);
	const need = [...KEYWORD_KEYS, ...INT_KEYS];
	try {
		const info = await c.getCollection(C);
		const have = new Set(Object.keys(info.payload_schema ?? {}));
		if (need.every((k) => have.has(k))) return;
	} catch {
		/* collection missing — fall through and create it */
	}
	await c
		.createCollection(C, { vectors: { [V]: { size: 4096, distance: 'Cosine' } } })
		.catch(() => {});
	await Promise.all([
		...KEYWORD_KEYS.map((k) =>
			c.createPayloadIndex(C, { field_name: k, field_schema: 'keyword' }).catch(() => {})
		),
		...INT_KEYS.map((k) =>
			c.createPayloadIndex(C, { field_name: k, field_schema: 'integer' }).catch(() => {})
		)
	]);
}

// `start_from` is inclusive, and Qdrant 400s when `offset` and `order_by` arrive together —
// ordered scroll pages by the ordered value, not by point id. Since scroll() swallows errors
// into [], sending both would read as "nothing matched", so the key must be absent entirely.
export type OrderBy = { key: string; direction: 'asc' | 'desc'; start_from?: number };

export async function scroll(
	env: QEnv,
	filter: Filter,
	limit = 1000,
	offset?: number,
	order_by?: OrderBy
): Promise<Pt[]> {
	const r = await (
		await qc(env)
	)
		.scroll(C, {
			filter,
			limit,
			...(order_by ? { order_by } : { offset }),
			with_payload: true,
			with_vector: false
		})
		.catch(() => ({ points: [] as Pt[] }));
	return r.points as Pt[];
}

export async function retrieve_one(env: QEnv, id: string, with_vector = false): Promise<Pt | null> {
	const r = await (await qc(env)).retrieve(C, { ids: [id], with_vector }).catch(() => []);
	return (r[0] as Pt) ?? null;
}

export async function retrieve_many(env: QEnv, ids: string[]): Promise<Pt[]> {
	if (!ids.length) return [];
	const r = await (await qc(env)).retrieve(C, { ids, with_payload: true }).catch(() => []);
	return r as Pt[];
}

export async function search(
	env: QEnv,
	vector: number[],
	filter: Filter,
	limit = 12,
	offset?: number
): Promise<Pt[]> {
	const r = await (
		await qc(env)
	)
		.search(C, { vector: { name: V, vector }, filter, limit, offset, with_payload: true })
		.catch(() => []);
	return r as unknown as Pt[];
}

export async function remove(env: QEnv, ids: string[]): Promise<void> {
	if (!ids.length) return;
	await (await qc(env)).delete(C, { points: ids });
}

export async function upsert(env: QEnv, points: Pt[]): Promise<void> {
	if (!points.length) return;
	await (
		await qc(env)
	).upsert(C, {
		points: points as unknown as {
			id: string | number;
			vector: number[] | Record<string, number[]>;
			payload: Record<string, unknown>;
		}[]
	});
}

export async function update_vectors(env: QEnv, id: string, vector: number[]): Promise<void> {
	await (
		await qc(env)
	).updateVectors(C, {
		points: [{ id, vector: { [V]: vector } }]
	});
}

export async function set_payload(
	env: QEnv,
	id: string,
	payload: Record<string, unknown>
): Promise<void> {
	await (await qc(env)).setPayload(C, { payload, points: [id] });
}

/**
 * Removes keys outright rather than setting them to null. Destroying content — a burnt
 * view-once message, a message deleted for everyone — has to leave nothing behind to read
 * back, and a null still tells you the key was there.
 */
export async function clear_payload(env: QEnv, id: string, keys: string[]): Promise<void> {
	if (!keys.length) return;
	await (await qc(env)).deletePayload(C, { keys, points: [id] });
}
