import { describe, it, expect } from 'vitest';
import { online } from '../online';

function ns(states: Record<string, boolean>, throwFor: string[] = []) {
	return {
		idFromName: (n: string) => n,
		get: (id: unknown) => ({
			fetch: async () => {
				const uid = id as string;
				if (throwFor.includes(uid)) throw new Error('DO unreachable');
				return new Response(JSON.stringify({ online: states[uid] ?? false }));
			}
		})
	};
}

describe('online', () => {
	it('returns only the uids with a live socket', async () => {
		const r = await online({ uids: ['ada', 'bob', 'cy'] }, ns({ ada: true, bob: false, cy: true }));
		expect(r?.sort()).toEqual(['ada', 'cy']);
	});

	it('treats an unreachable hub as offline rather than failing the batch', async () => {
		const r = await online({ uids: ['ada', 'bob'] }, ns({ ada: true, bob: true }, ['bob']));
		expect(r).toEqual(['ada']);
	});

	it('rejects a malformed body', async () => {
		expect(await online(null, ns({}))).toBeNull();
		expect(await online({ uids: 'nope' }, ns({}))).toBeNull();
	});

	it('caps the fan-out so one request cannot blow the subrequest budget', async () => {
		const uids = Array.from({ length: 250 }, (_, i) => `u${i}`);
		const states = Object.fromEntries(uids.map((u) => [u, true]));
		const r = await online({ uids }, ns(states));
		expect(r).toHaveLength(100);
	});
});
