import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockClient = vi.hoisted(() => ({
	createCollection: vi.fn().mockResolvedValue(undefined),
	createPayloadIndex: vi.fn().mockResolvedValue(undefined),
	getCollection: vi.fn().mockRejectedValue(new Error('not found')),
	scroll: vi.fn().mockResolvedValue({ points: [] }),
	search: vi.fn().mockResolvedValue([]),
	upsert: vi.fn().mockResolvedValue(undefined),
	delete: vi.fn().mockResolvedValue(undefined),
	updateVectors: vi.fn().mockResolvedValue(undefined),
	setPayload: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('@qdrant/js-client-rest', () => {
	const Fn = function () {
		return mockClient;
	} as unknown as typeof import('@qdrant/js-client-rest').QdrantClient;
	return { QdrantClient: Fn };
});

import type { QEnv, Cond } from '../qdrant';
import { ZV, __reset_qdrant } from '../qdrant';

const ENV = { QDRANT_URL: 'http://localhost', QDRANT_KEY: 'k' } as unknown as QEnv;

beforeEach(() => {
	vi.clearAllMocks();
	vi.resetModules();
	__reset_qdrant();
});

describe('ensure', () => {
	it('probes the collection and creates indexes when missing', async () => {
		mockClient.getCollection.mockRejectedValue(new Error('not found'));

		const { ensure } = await import('../qdrant');
		await ensure(ENV);

		expect(mockClient.createCollection).toHaveBeenCalledTimes(1);
		expect(mockClient.createPayloadIndex).toHaveBeenCalled();
	});

	it('creates an integer index for d, the message timestamp ordered scroll needs', async () => {
		mockClient.getCollection.mockRejectedValue(new Error('not found'));

		const { ensure } = await import('../qdrant');
		await ensure(ENV);

		expect(mockClient.createPayloadIndex).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ field_name: 'd', field_schema: 'integer' })
		);
	});

	it('skips all creation when every index already exists', async () => {
		mockClient.getCollection.mockResolvedValue({
			payload_schema: {
				s: {}, t: {}, r: {}, c: {}, f: {}, co: {}, st: {}, ci: {}, u: {},
				ow: {}, mb: {}, gr: {}, uid: {}, ac: {}, tg: {}, k: {},
				ag: {}, at: {}, sent: {}, d: {}
			}
		});

		const { ensure } = await import('../qdrant');
		await ensure(ENV);

		expect(mockClient.createCollection).not.toHaveBeenCalled();
		expect(mockClient.createPayloadIndex).not.toHaveBeenCalled();
	});

	it('is idempotent — a second call does not re-issue creation', async () => {
		mockClient.getCollection.mockRejectedValue(new Error('not found'));

		const { ensure } = await import('../qdrant');
		await ensure(ENV);
		expect(mockClient.createCollection).toHaveBeenCalledTimes(1);

		await ensure(ENV);
		expect(mockClient.createCollection).toHaveBeenCalledTimes(1);
	});

	it('does not throw when the collection already exists', async () => {
		mockClient.getCollection.mockRejectedValue(new Error('not found'));
		mockClient.createCollection = vi.fn().mockRejectedValue(new Error('already exists'));

		const { ensure } = await import('../qdrant');
		await expect(ensure(ENV)).resolves.toBeUndefined();
		expect(mockClient.createPayloadIndex).toHaveBeenCalled();
	});
});

describe('scroll', () => {
	it('passes offset through to the Qdrant client on scroll', async () => {
		const { scroll: scrollFn, f, eq } = await import('../qdrant');
		await scrollFn(ENV, f(eq('s', 'm') as Cond), 10, 5);

		const opts = mockClient.scroll.mock.calls[0][1];
		expect(opts.offset).toBe(5);
	});

	it('omits offset when not given, so existing callers are unaffected', async () => {
		const { scroll: scrollFn, f, eq } = await import('../qdrant');
		await scrollFn(ENV, f(eq('s', 'm') as Cond), 10);

		const opts = mockClient.scroll.mock.calls[0][1];
		expect(opts.offset).toBeUndefined();
	});

	it('forwards order_by when given', async () => {
		const { scroll: scrollFn, f, eq } = await import('../qdrant');
		const order_by = { key: 'd', direction: 'desc' as const };
		await scrollFn(ENV, f(eq('s', 'm') as Cond), 50, undefined, order_by);

		const opts = mockClient.scroll.mock.calls[0][1];
		expect(opts.order_by).toEqual(order_by);
	});

	it('carries start_from through for cursor paging', async () => {
		const { scroll: scrollFn, f, eq } = await import('../qdrant');
		const order_by = { key: 'd', direction: 'desc' as const, start_from: 1999 };
		await scrollFn(ENV, f(eq('s', 'm') as Cond), 50, undefined, order_by);

		const opts = mockClient.scroll.mock.calls[0][1];
		expect(opts.order_by).toEqual(order_by);
	});

	// Qdrant 400s when offset and order_by arrive together, and scroll() swallows errors
	// into [] — so the key must be absent, not merely undefined.
	it('omits the offset key entirely when order_by is given', async () => {
		const { scroll: scrollFn, f, eq } = await import('../qdrant');
		await scrollFn(ENV, f(eq('s', 'm') as Cond), 50, 5, {
			key: 'd',
			direction: 'desc'
		});

		const opts = mockClient.scroll.mock.calls[0][1];
		expect('offset' in opts).toBe(false);
	});

	it('omits the order_by key entirely when it is not given', async () => {
		const { scroll: scrollFn, f, eq } = await import('../qdrant');
		await scrollFn(ENV, f(eq('s', 'm') as Cond), 10, 5);

		const opts = mockClient.scroll.mock.calls[0][1];
		expect('order_by' in opts).toBe(false);
		expect(opts.offset).toBe(5);
	});
});

describe('search', () => {
	it('passes offset through to the Qdrant client on search', async () => {
		const { search: searchFn, f, eq } = await import('../qdrant');
		await searchFn(ENV, ZV, f(eq('s', 'm') as Cond), 12, 3);

		const opts = mockClient.search.mock.calls[0][1];
		expect(opts.offset).toBe(3);
	});

	it('omits offset when not given, so existing callers are unaffected', async () => {
		const { search: searchFn, f, eq } = await import('../qdrant');
		await searchFn(ENV, ZV, f(eq('s', 'm') as Cond), 12);

		const opts = mockClient.search.mock.calls[0][1];
		expect(opts.offset).toBeUndefined();
	});
});

describe('set_payload', () => {
	it('writes payload only, for exactly the given point id', async () => {
		const { set_payload } = await import('../qdrant');
		await set_payload(ENV, 'g1', { nm: 'renamed' });
		expect(mockClient.setPayload).toHaveBeenCalledWith('x2', {
			payload: { nm: 'renamed' },
			points: ['g1']
		});
	});
});

// A failed write must be visible to the caller — a silently swallowed error means the app
// answers 200 OK for a message that was never stored. These reassign rejected implementations
// onto the shared mockClient and clearAllMocks() (in beforeEach) does not undo that, so keep
// this describe block last in the file — any success-path test added after would inherit the
// rejection.
describe('writes surface failures instead of swallowing them', () => {
	it('upsert rejects when the client rejects', async () => {
		mockClient.upsert.mockRejectedValue(new Error('qdrant down'));
		const { upsert } = await import('../qdrant');
		await expect(upsert(ENV, [{ id: '1', vector: ZV, payload: {} }])).rejects.toThrow(
			'qdrant down'
		);
	});

	it('remove rejects when the client rejects', async () => {
		mockClient.delete.mockRejectedValue(new Error('qdrant down'));
		const { remove } = await import('../qdrant');
		await expect(remove(ENV, ['1'])).rejects.toThrow('qdrant down');
	});

	it('update_vectors rejects when the client rejects', async () => {
		mockClient.updateVectors.mockRejectedValue(new Error('qdrant down'));
		const { update_vectors } = await import('../qdrant');
		await expect(update_vectors(ENV, '1', ZV)).rejects.toThrow('qdrant down');
	});

	it('set_payload rejects when the client rejects', async () => {
		mockClient.setPayload.mockRejectedValue(new Error('qdrant down'));
		const { set_payload } = await import('../qdrant');
		await expect(set_payload(ENV, '1', { x: 1 })).rejects.toThrow('qdrant down');
	});
});
