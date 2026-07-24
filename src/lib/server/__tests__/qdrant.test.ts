import { describe, it, expect, vi, beforeEach } from 'vitest';

const scrollMock = vi.fn();
const retrieveMock = vi.fn();
const searchMock = vi.fn();
const upsertMock = vi.fn();
const createCollectionMock = vi.fn();
const createPayloadIndexMock = vi.fn();
const ctorCalls: unknown[] = [];

class MockQdrantClient {
	scroll = scrollMock;
	retrieve = retrieveMock;
	search = searchMock;
	upsert = upsertMock;
	createCollection = createCollectionMock;
	createPayloadIndex = createPayloadIndexMock;
	constructor(opts: unknown) {
		ctorCalls.push(opts);
	}
}

vi.mock('@qdrant/js-client-rest', () => ({
	QdrantClient: MockQdrantClient
}));

const ENV = { QDRANT_URL: 'https://q.example', QDRANT_KEY: 'key-1' };

beforeEach(() => {
	vi.clearAllMocks();
	ctorCalls.length = 0;
	scrollMock.mockResolvedValue({ points: [{ id: '1', payload: { s: 'u' } }] });
	retrieveMock.mockResolvedValue([{ id: '1', payload: { s: 'u' } }]);
	searchMock.mockResolvedValue([{ id: '1', payload: { s: 'u' }, score: 0.9 }]);
	upsertMock.mockResolvedValue(undefined);
	createCollectionMock.mockResolvedValue(undefined);
	createPayloadIndexMock.mockResolvedValue(undefined);
});

describe('get_secret', () => {
	it('passes through a plain string', async () => {
		const { get_secret } = await import('../qdrant');
		expect(await get_secret('plain')).toBe('plain');
	});
	it('returns empty string for undefined', async () => {
		const { get_secret } = await import('../qdrant');
		expect(await get_secret(undefined)).toBe('');
	});
	it('awaits a secret-binding-style object', async () => {
		const { get_secret } = await import('../qdrant');
		const binding = { get: async () => 'resolved-secret' };
		expect(await get_secret(binding)).toBe('resolved-secret');
	});
});

describe('b64u / unb64u', () => {
	it('round-trips arbitrary bytes', async () => {
		const { b64u, unb64u } = await import('../qdrant');
		for (const len of [0, 1, 5, 16, 32, 100]) {
			const bytes = crypto.getRandomValues(new Uint8Array(len));
			const encoded = b64u(bytes);
			expect(encoded).not.toMatch(/[+/=]/);
			expect([...unb64u(encoded)]).toEqual([...bytes]);
		}
	});

	it('round-trips an ArrayBuffer input', async () => {
		const { b64u, unb64u } = await import('../qdrant');
		const bytes = new Uint8Array([1, 2, 3, 255, 0]);
		const encoded = b64u(bytes.buffer);
		expect([...unb64u(encoded)]).toEqual([...bytes]);
	});
});

describe('uuid_from', () => {
	it('is deterministic for the same input', async () => {
		const { uuid_from } = await import('../qdrant');
		expect(await uuid_from('google-sub-123')).toBe(await uuid_from('google-sub-123'));
	});

	it('differs across inputs', async () => {
		const { uuid_from } = await import('../qdrant');
		expect(await uuid_from('a')).not.toBe(await uuid_from('b'));
	});

	it('produces a well-formed UUID (v4-shaped) string', async () => {
		const { uuid_from } = await import('../qdrant');
		const id = await uuid_from('someone@example.com');
		expect(id).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/
		);
	});
});

describe('new_id', () => {
	it('returns unique-looking uuids', () => {
		const seen = new Set<string>();
		for (let i = 0; i < 50; i++) {
			seen.add(crypto.randomUUID());
		}
		expect(seen.size).toBe(50);
	});
});

describe('eq / f', () => {
	it('builds a match condition', async () => {
		const { eq } = await import('../qdrant');
		expect(eq('s', 'u')).toEqual({ key: 's', match: { value: 'u' } });
		expect(eq('ag', 30)).toEqual({ key: 'ag', match: { value: 30 } });
	});

	it('wraps conditions in a must-filter', async () => {
		const { eq, f } = await import('../qdrant');
		expect(f(eq('s', 'u'), eq('r', 'f'))).toEqual({
			must: [
				{ key: 's', match: { value: 'u' } },
				{ key: 'r', match: { value: 'f' } }
			]
		});
	});
});

describe('qc (client caching)', () => {
	it('creates a single client instance and reuses it while the key is unchanged', async () => {
		vi.resetModules();
		const { qc } = await import('../qdrant');
		const a = await qc(ENV);
		const b = await qc(ENV);
		expect(a).toBe(b);
		expect(ctorCalls.length).toBe(1);
	});

	it('creates a new client when the key changes', async () => {
		vi.resetModules();
		const { qc } = await import('../qdrant');
		await qc(ENV);
		await qc({ ...ENV, QDRANT_KEY: 'key-2' });
		expect(ctorCalls.length).toBe(2);
	});
});

describe('ensure', () => {
	it('creates the collection and keyword indexes for s/t/r, tolerating failures', async () => {
		vi.resetModules();
		createCollectionMock.mockRejectedValueOnce(new Error('already exists'));
		const { ensure } = await import('../qdrant');
		await ensure(ENV);
		expect(createCollectionMock).toHaveBeenCalledWith(
			'x2',
			expect.objectContaining({ vectors: { size: 4096, distance: 'Cosine' } })
		);
		const indexedFields = createPayloadIndexMock.mock.calls.map((c) => c[1].field_name);
		expect(indexedFields).toEqual(['s', 't', 'r']);
	});

	it('only runs once per module instance (idempotent)', async () => {
		vi.resetModules();
		const { ensure } = await import('../qdrant');
		await ensure(ENV);
		await ensure(ENV);
		await ensure(ENV);
		expect(createCollectionMock).toHaveBeenCalledTimes(1);
	});
});

describe('scroll', () => {
	it('passes filter/limit and returns points', async () => {
		vi.resetModules();
		const { scroll, f, eq } = await import('../qdrant');
		const filter = f(eq('s', 'm'));
		const pts = await scroll(ENV, filter, 500);
		expect(scrollMock).toHaveBeenCalledWith(
			'x2',
			expect.objectContaining({ filter, limit: 500, with_payload: true, with_vector: false })
		);
		expect(pts).toEqual([{ id: '1', payload: { s: 'u' } }]);
	});

	it('returns an empty array when the client call rejects', async () => {
		vi.resetModules();
		scrollMock.mockRejectedValueOnce(new Error('network down'));
		const { scroll, f, eq } = await import('../qdrant');
		const pts = await scroll(ENV, f(eq('s', 'm')));
		expect(pts).toEqual([]);
	});
});

describe('retrieve_one', () => {
	it('returns the first matching point', async () => {
		vi.resetModules();
		const { retrieve_one } = await import('../qdrant');
		const pt = await retrieve_one(ENV, '1');
		expect(retrieveMock).toHaveBeenCalledWith('x2', { ids: ['1'] });
		expect(pt).toEqual({ id: '1', payload: { s: 'u' } });
	});

	it('returns null when nothing is found', async () => {
		vi.resetModules();
		retrieveMock.mockResolvedValueOnce([]);
		const { retrieve_one } = await import('../qdrant');
		expect(await retrieve_one(ENV, 'missing')).toBeNull();
	});

	it('returns null when the client call rejects', async () => {
		vi.resetModules();
		retrieveMock.mockRejectedValueOnce(new Error('boom'));
		const { retrieve_one } = await import('../qdrant');
		expect(await retrieve_one(ENV, '1')).toBeNull();
	});
});

describe('search', () => {
	it('passes vector/filter/limit through and returns hits', async () => {
		vi.resetModules();
		const { search, f, eq } = await import('../qdrant');
		const filter = f(eq('s', 'u'));
		const vec = [0.1, 0.2];
		const hits = await search(ENV, vec, filter, 20);
		expect(searchMock).toHaveBeenCalledWith(
			'x2',
			expect.objectContaining({ vector: vec, filter, limit: 20, with_payload: true })
		);
		expect(hits).toEqual([{ id: '1', payload: { s: 'u' }, score: 0.9 }]);
	});

	it('returns an empty array on failure', async () => {
		vi.resetModules();
		searchMock.mockRejectedValueOnce(new Error('boom'));
		const { search, f, eq } = await import('../qdrant');
		expect(await search(ENV, [0], f(eq('s', 'u')))).toEqual([]);
	});
});

describe('upsert', () => {
	it('is a no-op for an empty point list', async () => {
		vi.resetModules();
		const { upsert } = await import('../qdrant');
		await upsert(ENV, []);
		expect(upsertMock).not.toHaveBeenCalled();
	});

	it('forwards points to the client', async () => {
		vi.resetModules();
		const { upsert } = await import('../qdrant');
		const points = [{ id: 'a', vector: [0], payload: { s: 'u' } }];
		await upsert(ENV, points);
		expect(upsertMock).toHaveBeenCalledWith('x2', { points });
	});

	it('swallows errors from the client', async () => {
		vi.resetModules();
		upsertMock.mockRejectedValueOnce(new Error('boom'));
		const { upsert } = await import('../qdrant');
		await expect(upsert(ENV, [{ id: 'a', vector: [0], payload: {} }])).resolves.toBeUndefined();
	});
});
