import { describe, it, expect, vi } from 'vitest';
import { relay, type HubNs } from '../relay';

/** a DO namespace whose per-uid hub reports whether it had a live socket */
function hubs(delivered: Record<string, boolean | 'throw' | 'legacy'>) {
	const calls: { uid: string; body: Record<string, unknown> }[] = [];
	const ns: HubNs = {
		idFromName: (n: string) => n,
		get: (id: unknown) => ({
			fetch: async (req: Request) => {
				const body = (await req.json()) as Record<string, unknown>;
				const uid = String(id);
				calls.push({ uid, body });
				const state = delivered[uid];
				if (state === 'throw') throw new Error('hub unreachable');
				if (state === 'legacy') return new Response('ok', { status: 200 });
				return new Response(JSON.stringify({ delivered: state ?? false }), { status: 200 });
			}
		})
	};
	return { ns, calls };
}

const msg = { id: 'm1', from: 'ada', from_name: 'ada', text: 'hi', ts: 1 };

describe('relay — routing', () => {
	it('routes a direct message to the recipient’s hub', async () => {
		const { ns, calls } = hubs({ bob: true });
		await relay({ ...msg, to: 'bob' }, ns);
		expect(calls.map((c) => c.uid)).toEqual(['bob']);
	});

	it('fans a group message out to one hub per member', async () => {
		const { ns, calls } = hubs({ bob: true, cid: true });
		await relay({ ...msg, members: ['bob', 'cid'], group: 'g1' }, ns);
		expect(calls.map((c) => c.uid).sort()).toEqual(['bob', 'cid']);
	});

	it('addresses each member’s copy to that member', async () => {
		const { ns, calls } = hubs({ bob: true, cid: true });
		await relay({ ...msg, members: ['bob', 'cid'] }, ns);
		expect(calls.map((c) => c.body.to).sort()).toEqual(['bob', 'cid']);
	});

	it('passes the message body through untouched', async () => {
		const { ns, calls } = hubs({ bob: true });
		await relay({ ...msg, to: 'bob', image: 'ada/x.png' }, ns);
		expect(calls[0].body).toMatchObject({ id: 'm1', text: 'hi', image: 'ada/x.png' });
	});

	it('returns null when there is nobody to relay to', async () => {
		const { ns, calls } = hubs({});
		expect(await relay({ ...msg }, ns)).toBeNull();
		expect(calls).toHaveLength(0);
	});

	it('returns null for an empty member list', async () => {
		const { ns } = hubs({});
		expect(await relay({ ...msg, members: [] }, ns)).toBeNull();
	});

	it('returns null for a missing body', async () => {
		const { ns } = hubs({});
		expect(await relay(null, ns)).toBeNull();
	});
});

describe('relay — reporting who was missed', () => {
	it('reports nobody undelivered when every hub had a live socket', async () => {
		const { ns } = hubs({ bob: true, cid: true });
		expect(await relay({ ...msg, members: ['bob', 'cid'] }, ns)).toEqual({
			ok: true,
			undelivered: []
		});
	});

	it('names the recipients whose hub had no socket — these are the ones to push', async () => {
		const { ns } = hubs({ bob: true, cid: false });
		expect((await relay({ ...msg, members: ['bob', 'cid'] }, ns))!.undelivered).toEqual(['cid']);
	});

	it('reports a direct recipient who is offline', async () => {
		const { ns } = hubs({ bob: false });
		expect((await relay({ ...msg, to: 'bob' }, ns))!.undelivered).toEqual(['bob']);
	});

	it('counts an unreachable hub as undelivered — better a push than a lost message', async () => {
		const { ns } = hubs({ bob: 'throw' });
		expect((await relay({ ...msg, to: 'bob' }, ns))!.undelivered).toEqual(['bob']);
	});

	it('counts an unrecognised hub response as undelivered, for the same reason', async () => {
		const { ns } = hubs({ bob: 'legacy' });
		expect((await relay({ ...msg, to: 'bob' }, ns))!.undelivered).toEqual(['bob']);
	});

	it('is not ok when every hub failed', async () => {
		const { ns } = hubs({ bob: 'throw', cid: 'throw' });
		expect((await relay({ ...msg, members: ['bob', 'cid'] }, ns))!.ok).toBe(false);
	});

	it('is ok when at least one hub answered', async () => {
		const { ns } = hubs({ bob: 'throw', cid: false });
		expect((await relay({ ...msg, members: ['bob', 'cid'] }, ns))!.ok).toBe(true);
	});
});
