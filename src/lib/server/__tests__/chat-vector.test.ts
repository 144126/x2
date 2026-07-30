import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
	ensureMock,
	upsertMock,
	updateVectorsMock,
	embedMock
} = vi.hoisted(() => ({
	ensureMock: vi.fn(),
	upsertMock: vi.fn(),
	updateVectorsMock: vi.fn(),
	embedMock: vi.fn()
}));

vi.mock('../qdrant', async () => {
	const actual = await vi.importActual<typeof import('../qdrant')>('../qdrant');
	return {
		...actual,
		ensure: ensureMock,
		upsert: upsertMock,
		update_vectors: updateVectorsMock
	};
});
vi.mock('../or', () => ({ embed: embedMock }));

import { backfill_vector } from '../chat';
import { ZV } from '../qdrant';

const ENV = { QDRANT_URL: 'u', QDRANT_KEY: 'k' };

beforeEach(() => {
	vi.clearAllMocks();
	ensureMock.mockResolvedValue(undefined);
	upsertMock.mockResolvedValue(undefined);
	updateVectorsMock.mockResolvedValue(undefined);
	embedMock.mockResolvedValue(new Array(4096).fill(0.5));
});

describe('backfill_vector', () => {
	it('calls embed then update_vectors (not upsert)', async () => {
		await backfill_vector(ENV, 'm1', 'hello there');
		expect(embedMock).toHaveBeenCalledWith(ENV, 'hello there');
		expect(updateVectorsMock).toHaveBeenCalledOnce();
		expect(upsertMock).not.toHaveBeenCalled();
		const [env, id, vec] = updateVectorsMock.mock.calls[0];
		expect(id).toBe('m1');
		expect(vec).toHaveLength(4096);
	});

	it('skips short text (under 3 chars)', async () => {
		await backfill_vector(ENV, 'm1', 'ok');
		expect(embedMock).not.toHaveBeenCalled();
		expect(updateVectorsMock).not.toHaveBeenCalled();
	});

	it('does not call update_vectors when embed returns ZV (API failure)', async () => {
		embedMock.mockResolvedValue(ZV);
		await backfill_vector(ENV, 'm1', 'hello there');
		expect(embedMock).toHaveBeenCalled();
		expect(updateVectorsMock).not.toHaveBeenCalled();
	});

	it('calls update_vectors, not upsert (regression guard for edit/delete window)', async () => {
		await backfill_vector(ENV, 'm1', 'hello there');
		const updateCall = updateVectorsMock.mock.calls[0];
		expect(updateCall[1]).toBe('m1');
		expect(Array.isArray(updateCall[2])).toBe(true);
		expect(upsertMock).not.toHaveBeenCalled();
	});
});
