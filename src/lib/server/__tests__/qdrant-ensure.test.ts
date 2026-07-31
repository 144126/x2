import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockClient = vi.hoisted(() => ({
	createCollection: vi.fn().mockResolvedValue(undefined),
	createPayloadIndex: vi.fn().mockResolvedValue(undefined),
	getCollection: vi.fn().mockRejectedValue(new Error('not found'))
}));

vi.mock('@qdrant/js-client-rest', () => {
	const Fn = function () {
		return mockClient;
	} as unknown as typeof import('@qdrant/js-client-rest').QdrantClient;
	return { QdrantClient: Fn };
});

import { ensure, __reset_qdrant } from '../qdrant';
import type { QEnv } from '../qdrant';

const ENV = { QDRANT_URL: 'http://localhost', QDRANT_KEY: 'k' } as unknown as QEnv;

beforeEach(() => {
	vi.clearAllMocks();
	__reset_qdrant();
});

describe('ensure — probe-first', () => {
	it('skips all creation when all 21 keys exist', async () => {
		mockClient.getCollection.mockResolvedValue({
			payload_schema: {
				s: {}, t: {}, r: {}, c: {}, f: {}, co: {}, st: {}, ci: {}, u: {},
				ow: {}, mb: {}, gr: {}, uid: {}, ac: {}, tg: {}, k: {}, rs: {},
				ag: {}, at: {}, sent: {}, d: {}
			}
		});
		await ensure(ENV);
		expect(mockClient.createCollection).not.toHaveBeenCalled();
		expect(mockClient.createPayloadIndex).not.toHaveBeenCalled();
	});

	it('creates collection + all indexes when getCollection fails', async () => {
		mockClient.getCollection.mockRejectedValue(new Error('not found'));
		await ensure(ENV);
		expect(mockClient.createCollection).toHaveBeenCalledTimes(1);
		expect(mockClient.createPayloadIndex).toHaveBeenCalledTimes(21);
	});

	it('creates missing indexes when some are absent (collection already exists)', async () => {
		mockClient.getCollection.mockResolvedValue({
			payload_schema: { s: {}, t: {}, r: {} }
		});
		mockClient.createCollection.mockRejectedValue(new Error('already exists'));
		await ensure(ENV);
		expect(mockClient.createCollection).toHaveBeenCalledTimes(1);
		expect(mockClient.createPayloadIndex).toHaveBeenCalledTimes(21);
	});

	it('calls getCollection only once for concurrent calls (stampede guard)', async () => {
		mockClient.getCollection.mockRejectedValue(new Error('not found'));
		await Promise.all([ensure(ENV), ensure(ENV), ensure(ENV)]);
		expect(mockClient.getCollection).toHaveBeenCalledTimes(1);
	});

	it('never throws even when collection creation fails', async () => {
		mockClient.getCollection.mockRejectedValue(new Error('not found'));
		mockClient.createCollection.mockRejectedValue(new Error('network error'));
		mockClient.createPayloadIndex.mockRejectedValue(new Error('network error'));
		await expect(ensure(ENV)).resolves.toBeUndefined();
	});
});
