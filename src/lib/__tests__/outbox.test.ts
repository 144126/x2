import { describe, it, expect, vi } from 'vitest';
import { MAX_TRIES, drain, queue, type OutStore, type Outgoing } from '../outbox';

// a Map standing in for the IndexedDB object store the service worker uses
function store(): OutStore & { rows: Map<string, Outgoing> } {
	const rows = new Map<string, Outgoing>();
	return {
		rows,
		all: async () => [...rows.values()].sort((a, b) => a.at - b.at),
		put: async (o) => void rows.set(o.id, o),
		del: async (id) => void rows.delete(id)
	};
}

const sent = () => vi.fn().mockResolvedValue(true);
const failed = () => vi.fn().mockResolvedValue(false);

describe('queue', () => {
	it('keeps the message so an offline send is not lost', async () => {
		const s = store();
		await queue(s, { to: 'a', text: 'hi' });
		expect((await s.all())[0].body).toEqual({ to: 'a', text: 'hi' });
	});

	it('gives every entry its own id', async () => {
		const s = store();
		const a = await queue(s, { text: '1' });
		const b = await queue(s, { text: '2' });
		expect(a.id).not.toBe(b.id);
	});

	it('starts with no attempts recorded', async () => {
		const s = store();
		expect((await queue(s, { text: 'hi' })).tries).toBe(0);
	});

	it('timestamps entries so they drain oldest-first', async () => {
		const s = store();
		await queue(s, { text: '1' }, 100);
		await queue(s, { text: '2' }, 50);
		expect((await s.all()).map((o) => o.body)).toEqual([{ text: '2' }, { text: '1' }]);
	});
});

describe('drain', () => {
	it('sends nothing when the queue is empty', async () => {
		const post = sent();
		expect(await drain(store(), post)).toMatchObject({ sent: 0, kept: 0 });
		expect(post).not.toHaveBeenCalled();
	});

	it('posts each queued message and clears it', async () => {
		const s = store();
		await queue(s, { text: '1' }, 1);
		await queue(s, { text: '2' }, 2);
		const post = sent();
		expect(await drain(s, post)).toMatchObject({ sent: 2, kept: 0 });
		expect(post).toHaveBeenCalledTimes(2);
		expect(await s.all()).toEqual([]);
	});

	it('sends in the order the user typed them', async () => {
		const s = store();
		await queue(s, { text: 'first' }, 1);
		await queue(s, { text: 'second' }, 2);
		const post = sent();
		await drain(s, post);
		expect(post.mock.calls.map((c) => c[0])).toEqual([{ text: 'first' }, { text: 'second' }]);
	});

	it('keeps a message that failed to send', async () => {
		const s = store();
		await queue(s, { text: 'hi' });
		expect(await drain(s, failed())).toMatchObject({ sent: 0, kept: 1 });
		expect(await s.all()).toHaveLength(1);
	});

	it('counts the attempt so a poison message cannot retry forever', async () => {
		const s = store();
		await queue(s, { text: 'hi' });
		await drain(s, failed());
		expect((await s.all())[0].tries).toBe(1);
	});

	it('drops a message once it has exhausted its retries', async () => {
		const s = store();
		await queue(s, { text: 'hi' });
		for (let i = 0; i < MAX_TRIES; i++) await drain(s, failed());
		expect(await s.all()).toEqual([]);
	});

	it('reports the drop rather than swallowing it', async () => {
		const s = store();
		const o = await queue(s, { text: 'hi' });
		await s.put({ ...o, tries: MAX_TRIES - 1 });
		expect(await drain(s, failed())).toMatchObject({ dropped: 1 });
	});

	it('keeps draining after one message fails', async () => {
		const s = store();
		await queue(s, { text: 'bad' }, 1);
		await queue(s, { text: 'good' }, 2);
		const post = vi.fn(async (b: { text: string }) => b.text === 'good');
		expect(await drain(s, post)).toMatchObject({ sent: 1, kept: 1 });
	});

	it('treats a thrown network error as a failure, not a crash', async () => {
		const s = store();
		await queue(s, { text: 'hi' });
		const post = vi.fn().mockRejectedValue(new Error('offline'));
		await expect(drain(s, post)).resolves.toMatchObject({ sent: 0, kept: 1 });
	});
});
