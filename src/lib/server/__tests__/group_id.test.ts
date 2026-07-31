import { describe, it, expect, vi } from 'vitest';
import { new_group_id } from '../qdrant';

describe('new_group_id', () => {
	it('returns an id at least 9 characters long', async () => {
		const id = await new_group_id({} as never, async () => false);
		expect(id.length).toBeGreaterThanOrEqual(9);
	});
	it('retries when the generated id already exists, then succeeds', async () => {
		let calls = 0;
		const exists = vi.fn(async () => {
			calls += 1;
			return calls === 1;
		});
		const id = await new_group_id({} as never, exists);
		expect(exists).toHaveBeenCalledTimes(2);
		expect(id.length).toBeGreaterThanOrEqual(9);
	});
	it('throws after 5 failed attempts', async () => {
		await expect(new_group_id({} as never, async () => true)).rejects.toThrow('id_unavailable');
	});
});
