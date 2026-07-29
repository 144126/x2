import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockClient = vi.hoisted(() => ({
	createCollection: vi.fn().mockResolvedValue(undefined),
	createPayloadIndex: vi.fn().mockResolvedValue(undefined),
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
import { ZV } from '../qdrant';

const ENV = { QDRANT_URL: 'http://localhost', QDRANT_KEY: 'k' } as unknown as QEnv;

beforeEach(() => {
	vi.clearAllMocks();
	vi.resetModules();
});

describe('ensure', () => {
	it('creates a payload index for every key any module filters on', async () => {
		const { ensure } = await import('../qdrant');
		await ensure(ENV);

		const keys = mockClient.createPayloadIndex.mock.calls.map(
			(c: [string, { field_name: string }]) => c[1].field_name
		);
		expect(keys).toEqual(
			expect.arrayContaining([
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
				'ag',
				'at',
				'sent'
			])
		);
	});

	it('is idempotent — a second call does not re-issue index creation', async () => {
		const { ensure } = await import('../qdrant');
		await ensure(ENV);
		expect(mockClient.createCollection).toHaveBeenCalledTimes(1);

		await ensure(ENV);
		expect(mockClient.createCollection).toHaveBeenCalledTimes(1);
	});

	it('does not throw when the collection already exists', async () => {
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
