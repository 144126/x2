import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockClient = vi.hoisted(() => ({
	createCollection: vi.fn().mockResolvedValue(undefined),
	createPayloadIndex: vi.fn().mockResolvedValue(undefined),
	getCollection: vi.fn().mockRejectedValue(new Error('not found')),
	scroll: vi.fn().mockResolvedValue({ points: [] }),
	search: vi.fn().mockResolvedValue([])
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

	it('skips all creation when every index already exists', async () => {
		mockClient.getCollection.mockResolvedValue({
			payload_schema: {
				s: {}, t: {}, r: {}, c: {}, f: {}, co: {}, st: {}, ci: {}, u: {},
				ow: {}, mb: {}, gr: {}, uid: {}, ac: {}, tg: {}, k: {},
				ag: {}, at: {}, sent: {}
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
