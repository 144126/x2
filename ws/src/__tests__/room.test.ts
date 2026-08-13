import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Room } from '../room';

function makeState() {
	const store = new Map<string, unknown>();
	return {
		storage: {
			get: vi.fn(async (k: string) => store.get(k)),
			put: vi.fn(async (k: string, v: unknown) => {
				store.set(k, v);
			}),
			delete: vi.fn(async (k: string) => {
				store.delete(k);
			}),
			list: vi.fn(async (opts?: { prefix?: string }) => {
				const prefix = opts?.prefix ?? '';
				const entries = [...store.entries()].filter(([k]) => k.startsWith(prefix));
				return new Map(entries);
			})
		}
	};
}

function req(path: string, init?: RequestInit) {
	return new Request(`https://dummy${path}`, init);
}

describe('Room', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('starts with an empty member list', async () => {
		const room = new Room(makeState() as any, {} as any);
		const res = await room.fetch(req('/members'));
		expect(await res.json()).toEqual({ members: [] });
	});

	it('adds a joiner', async () => {
		const room = new Room(makeState() as any, {} as any);
		const res = await room.fetch(
			req('/join', { method: 'POST', body: JSON.stringify({ uid: 'alice' }) })
		);
		expect(await res.json()).toEqual({ members: ['alice'] });
	});

	it('join is idempotent', async () => {
		const room = new Room(makeState() as any, {} as any);
		await room.fetch(req('/join', { method: 'POST', body: JSON.stringify({ uid: 'alice' }) }));
		const res = await room.fetch(
			req('/join', { method: 'POST', body: JSON.stringify({ uid: 'alice' }) })
		);
		expect(await res.json()).toEqual({ members: ['alice'] });
	});

	it('adds multiple unique joiners', async () => {
		const room = new Room(makeState() as any, {} as any);
		await room.fetch(req('/join', { method: 'POST', body: JSON.stringify({ uid: 'alice' }) }));
		await room.fetch(req('/join', { method: 'POST', body: JSON.stringify({ uid: 'bob' }) }));
		const res = await room.fetch(req('/members'));
		expect(await res.json()).toEqual({ members: ['alice', 'bob'] });
	});

	it('removes a leaver', async () => {
		const room = new Room(makeState() as any, {} as any);
		await room.fetch(req('/join', { method: 'POST', body: JSON.stringify({ uid: 'alice' }) }));
		await room.fetch(req('/join', { method: 'POST', body: JSON.stringify({ uid: 'bob' }) }));
		const res = await room.fetch(
			req('/leave', { method: 'POST', body: JSON.stringify({ uid: 'alice' }) })
		);
		expect(await res.json()).toEqual({ members: ['bob'] });
	});

	it('leave of a non-member is a no-op', async () => {
		const room = new Room(makeState() as any, {} as any);
		await room.fetch(req('/join', { method: 'POST', body: JSON.stringify({ uid: 'alice' }) }));
		const res = await room.fetch(
			req('/leave', { method: 'POST', body: JSON.stringify({ uid: 'bob' }) })
		);
		expect(await res.json()).toEqual({ members: ['alice'] });
	});

	it('is-member returns true for a joined uid', async () => {
		const room = new Room(makeState() as any, {} as any);
		await room.fetch(req('/join', { method: 'POST', body: JSON.stringify({ uid: 'alice' }) }));
		const res = await room.fetch(req('/is-member?uid=alice'));
		expect(await res.json()).toEqual({ ok: true });
	});

	it('is-member returns false for a non-joined uid', async () => {
		const room = new Room(makeState() as any, {} as any);
		const res = await room.fetch(req('/is-member?uid=alice'));
		expect(await res.json()).toEqual({ ok: false });
	});
});
