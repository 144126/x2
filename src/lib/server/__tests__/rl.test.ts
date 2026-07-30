import { describe, it, expect, vi } from 'vitest';
import { guard } from '../rl';

function platform(rl?: { limit: (o: { key: string }) => Promise<{ success: boolean }> }) {
	return { env: rl ? { RL_SEND: rl } : {} } as unknown as App.Platform;
}

describe('guard', () => {
	it('returns silently when the binding is absent (dev/test, fail open)', async () => {
		await expect(guard(undefined, 'RL_SEND', 'uid1')).resolves.toBeUndefined();
		await expect(guard(platform(), 'RL_SEND', 'uid1')).resolves.toBeUndefined();
	});

	it('resolves when the limiter allows the request', async () => {
		const limit = vi.fn().mockResolvedValue({ success: true });
		await expect(guard(platform({ limit }), 'RL_SEND', 'uid1')).resolves.toBeUndefined();
	});

	it('throws a 429 when the limiter denies the request', async () => {
		const limit = vi.fn().mockResolvedValue({ success: false });
		await expect(guard(platform({ limit }), 'RL_SEND', 'uid1')).rejects.toMatchObject({
			status: 429
		});
	});

	it('forwards the exact key to the limiter', async () => {
		const limit = vi.fn().mockResolvedValue({ success: true });
		await guard(platform({ limit }), 'RL_SEND', 'uid1');
		expect(limit).toHaveBeenCalledWith({ key: 'uid1' });
	});
});
