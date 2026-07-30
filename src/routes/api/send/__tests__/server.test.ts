import { describe, it, expect, vi, beforeEach } from 'vitest';

const { sendMsgMock, sendGroupMsgMock, getGroupMock, saveScheduledMock, guardMock } = vi.hoisted(
	() => ({
		sendMsgMock: vi.fn(),
		sendGroupMsgMock: vi.fn(),
		getGroupMock: vi.fn(),
		saveScheduledMock: vi.fn(),
		guardMock: vi.fn()
	})
);

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$lib/server/chat', async () => {
	const actual = await vi.importActual<typeof import('$lib/server/chat')>('$lib/server/chat');
	return { ...actual, send_msg: sendMsgMock, send_group_msg: sendGroupMsgMock };
});
vi.mock('$lib/server/group', async () => {
	const actual = await vi.importActual<typeof import('$lib/server/group')>('$lib/server/group');
	return { ...actual, get_group: getGroupMock };
});
vi.mock('$lib/server/scheduled', () => ({
	save_scheduled: saveScheduledMock,
	MIN_LEAD_MS: 60_000
}));
vi.mock('$lib/server/rl', () => ({ guard: guardMock }));

import { POST } from '../+server';

let bg_tasks: Promise<unknown>[] = [];
let call_bodies: Record<string, unknown>[] = [];
function ws(response: unknown = { delivered: true }) {
	return {
		fetch: vi.fn(async (_url: string, init: { body: string }) => {
			call_bodies.push(JSON.parse(init.body));
			return new Response(JSON.stringify(response), { status: 200 });
		})
	};
}

function event(body: unknown, uid: string | null = 'ada', fetcher = ws()) {
	return {
		request: new Request('https://x/api/send', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		}),
		locals: {
			user: uid ? { id: uid, username: 'ada' } : null,
			x2_ws: fetcher,
			bg: (p: Promise<unknown>) => {
				bg_tasks.push(p);
			}
		},
		platform: undefined
	} as unknown as Parameters<typeof POST>[0];
}

const settle = () => Promise.all(bg_tasks);

beforeEach(() => {
	vi.clearAllMocks();
	bg_tasks = [];
	call_bodies = [];
	sendMsgMock.mockResolvedValue({ id: 'm1', f: 'ada', t: 'bob', x: 'hi', d: 1_700_000_000_000 });
	sendGroupMsgMock.mockResolvedValue({ id: 'm2', f: 'ada', x: 'hi', d: 1_700_000_000_000 });
	getGroupMock.mockResolvedValue({
		id: 'g1',
		name: 'design club',
		owner: 'ada',
		members: ['ada', 'bob', 'cid'],
		description: '',
		created: 1
	});
	saveScheduledMock.mockResolvedValue({ id: 'sm1', sent: 0 });
	guardMock.mockResolvedValue(undefined);
});

describe('POST /api/send — scheduling', () => {
	it('stores a scheduled message instead of sending when `at` is far enough out', async () => {
		const res = await POST(event({ to: 'bob', text: 'hi', at: Date.now() + 3_600_000 }));
		const body = await res.json();
		expect(body).toEqual({ ok: true, scheduled: true, id: 'sm1' });
		expect(saveScheduledMock).toHaveBeenCalled();
		expect(sendMsgMock).not.toHaveBeenCalled();
	});

	it('sends immediately when `at` is within the minimum lead time', async () => {
		await POST(event({ to: 'bob', text: 'hi', at: Date.now() + 1000 }));
		expect(sendMsgMock).toHaveBeenCalled();
		expect(saveScheduledMock).not.toHaveBeenCalled();
	});
});

describe('POST /api/send — validation', () => {
	it('401s when signed out', async () => {
		await expect(POST(event({ to: 'bob', text: 'hi' }, null))).rejects.toMatchObject({
			status: 401
		});
	});

	it('400s with neither text nor image', async () => {
		await expect(POST(event({ to: 'bob' }))).rejects.toMatchObject({ status: 400 });
	});

	it('400s with neither to nor group', async () => {
		await expect(POST(event({ text: 'hi' }))).rejects.toMatchObject({ status: 400 });
	});

	it('404s a group send to a nonexistent group', async () => {
		getGroupMock.mockResolvedValue(null);
		await expect(POST(event({ group: 'ghost', text: 'hi' }))).rejects.toMatchObject({
			status: 404
		});
	});

	it('403s a group send from a non-member', async () => {
		getGroupMock.mockResolvedValue({
			id: 'g1',
			name: 'design club',
			owner: 'owner',
			members: ['owner'],
			description: '',
			created: 1
		});
		await expect(POST(event({ group: 'g1', text: 'hi' }))).rejects.toMatchObject({ status: 403 });
	});
});

describe('POST /api/send — rate limiting', () => {
	it('429s and never calls send_msg when the limiter denies the request', async () => {
		guardMock.mockRejectedValue({ status: 429, body: { message: 'slow_down' } });
		await expect(POST(event({ to: 'bob', text: 'hi' }))).rejects.toMatchObject({ status: 429 });
		expect(sendMsgMock).not.toHaveBeenCalled();
	});

	it('keys the limiter on the sender uid', async () => {
		await POST(event({ to: 'bob', text: 'hi' }));
		expect(guardMock).toHaveBeenCalledWith(undefined, 'RL_SEND', 'ada');
	});
});

describe('POST /api/send — a failed write is surfaced, not silently 200d', () => {
	it('503s a 1:1 send when send_msg rejects, instead of lying with ok: true', async () => {
		sendMsgMock.mockRejectedValue(new Error('qdrant down'));
		await expect(POST(event({ to: 'bob', text: 'hi' }))).rejects.toMatchObject({ status: 503 });
	});

	it('503s a group send when send_group_msg rejects', async () => {
		sendGroupMsgMock.mockRejectedValue(new Error('qdrant down'));
		await expect(POST(event({ group: 'g1', text: 'hi' }))).rejects.toMatchObject({
			status: 503
		});
	});
});

describe('POST /api/send — response shape', () => {
	it('returns the stored message to the sender for a 1:1 send', async () => {
		const body = await (await POST(event({ to: 'bob', text: 'hi' }))).json();
		expect(body.m).toMatchObject({ id: 'm1', from: 'ada', to: 'bob', text: 'hi' });
	});

	it('returns the stored message to the sender for a group send', async () => {
		const body = await (await POST(event({ group: 'g1', text: 'hi all' }))).json();
		expect(body.m).toMatchObject({ id: 'm2', from: 'ada', group: 'g1', text: 'hi' });
	});
});

describe('POST /api/send — the relay call the recipient’s ChatHub receives', () => {
	it('zero scroll-shaped Qdrant work — relay + sender self-index, no scrolls', async () => {
		const fetcher = ws();
		await POST(event({ group: 'g1', text: 'hi' }, 'ada', fetcher));
		await settle();
		expect(fetcher.fetch).toHaveBeenCalledTimes(2);
		// first call is the relay to recipients, second is the sender self-index hub_conv
	});

	it('1:1: carries conv, mute_key and notification fields for the recipient’s own DO to use', async () => {
		await POST(event({ to: 'bob', text: 'hi' }));
		await settle();
		expect(call_bodies[0]).toMatchObject({
			to: 'bob',
			from: 'ada',
			conv: 'ada|bob',
			mute_key: 'ada',
			title: 'ada',
			push_body: 'hi',
			url: '/app/chat/ada',
			kind: 'u',
			reply_to: 'ada'
		});
	});

	it('group: carries conv, mute_key (the group id) and notification fields', async () => {
		await POST(event({ group: 'g1', text: 'hi' }));
		await settle();
		expect(call_bodies[0]).toMatchObject({
			group: 'g1',
			members: ['bob', 'cid'],
			conv: 'g:g1',
			mute_key: 'g1',
			title: 'design club',
			push_body: 'ada: hi',
			url: '/app/rooms/g1',
			kind: 'r',
			reply_to: 'g1'
		});
	});

	it('carries an attached photo in the relay payload', async () => {
		await POST(event({ to: 'bob', image: 'ada/x.png' }));
		await settle();
		expect(call_bodies[0]).toMatchObject({ image: '/media/ada/x.png' });
	});

	it('names the file in the group push body when a file is attached instead of text', async () => {
		const file = { key: 'x/doc.pdf', name: 'doc.pdf', size: 1234, type: 'application/pdf' };
		await POST(event({ group: 'g1', file, text: '' }));
		await settle();
		expect(call_bodies[0]).toMatchObject({ push_body: 'ada: 📎 doc.pdf' });
	});
});

describe('POST /api/send — background fan-out behaviour', () => {
	it('response does not wait on the relay call', async () => {
		const slow_ws = { fetch: vi.fn(() => new Promise(() => {})) };
		const res = await POST(event({ to: 'bob', text: 'hi' }, 'ada', slow_ws));
		const body = await res.json();
		expect(body).toMatchObject({ ok: true, m: { id: 'm1' } });
	});

	it('registers exactly one background task per send', async () => {
		await POST(event({ to: 'bob', text: 'hi' }));
		expect(bg_tasks).toHaveLength(1);
	});

	it('a throwing relay does not reject the handler', async () => {
		const broken = { fetch: vi.fn().mockRejectedValue(new Error('relay down')) };
		const res = await POST(event({ to: 'bob', text: 'hi' }, 'ada', broken));
		expect(res.status).toBe(200);
		await settle();
	});
});
