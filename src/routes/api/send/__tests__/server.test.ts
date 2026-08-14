import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
	sendMsgMock,
	sendGroupMsgMock,
	getGroupMock,
	isMemberMock,
	saveScheduledMock,
	guardMock,
	ensureDeviceSessionMock
} = vi.hoisted(() => ({
	sendMsgMock: vi.fn(),
	sendGroupMsgMock: vi.fn(),
	getGroupMock: vi.fn(),
	isMemberMock: vi.fn(),
	saveScheduledMock: vi.fn(),
	guardMock: vi.fn(),
	ensureDeviceSessionMock: vi.fn()
}));

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$lib/server/chat', async () => {
	const actual = await vi.importActual<typeof import('$lib/server/chat')>('$lib/server/chat');
	return { ...actual, send_msg: sendMsgMock, send_group_msg: sendGroupMsgMock };
});
vi.mock('$lib/server/group', async () => {
	const actual = await vi.importActual<typeof import('$lib/server/group')>('$lib/server/group');
	return { ...actual, get_group: getGroupMock, is_member: isMemberMock };
});
vi.mock('$lib/server/scheduled', () => ({
	save_scheduled: saveScheduledMock,
	MIN_LEAD_MS: 60_000
}));
vi.mock('$lib/server/rl', () => ({ guard: guardMock }));
vi.mock('$lib/server/device', () => ({ ensure_device_session: ensureDeviceSessionMock }));

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
	isMemberMock.mockResolvedValue(true);
	ensureDeviceSessionMock.mockResolvedValue(null);
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

describe('POST /api/send — anonymous device send', () => {
	it('sends as a freshly-minted device user when an anonymous visitor has a device_id', async () => {
		ensureDeviceSessionMock.mockResolvedValue({ id: 'dev1', username: 'dev1' });
		const res = await POST(event({ to: 'bob', text: 'hi' }, null));
		expect(res.status).toBe(200);
		expect(sendMsgMock).toHaveBeenCalledWith(
			expect.anything(),
			'dev1',
			'bob',
			'hi',
			undefined,
			undefined,
			undefined,
			undefined,
			undefined
		);
		expect(guardMock).toHaveBeenCalledWith(undefined, 'RL_SEND', 'dev1');
	});

	it('still 401s an anonymous send with no device_id at all', async () => {
		await expect(POST(event({ to: 'bob', text: 'hi' }, null))).rejects.toMatchObject({
			status: 401
		});
		expect(sendMsgMock).not.toHaveBeenCalled();
	});
});

describe('POST /api/send — validation', () => {
	it('401s when signed out', async () => {
		await expect(POST(event({ to: 'bob', text: 'hi' }, null))).rejects.toMatchObject({
			status: 401
		});
	});

	it('400s with neither text, image, file nor sticker', async () => {
		await expect(POST(event({ to: 'bob' }))).rejects.toMatchObject({ status: 400 });
	});

	it('accepts a sticker-only body (no text/image/file)', async () => {
		sendMsgMock.mockResolvedValue({
			id: 'm1',
			f: 'ada',
			t: 'bob',
			x: '',
			sk: 'wave',
			d: 1_700_000_000_000
		});
		const body = await (await POST(event({ to: 'bob', sticker: 'wave' }))).json();
		expect(sendMsgMock).toHaveBeenCalledWith(
			expect.anything(),
			'ada',
			'bob',
			'',
			undefined,
			undefined,
			undefined,
			'wave',
			undefined
		);
		expect(body.m).toMatchObject({ sk: 'wave' });
	});

	it('threads sticker into send_group_msg on a group send', async () => {
		sendGroupMsgMock.mockResolvedValue({
			id: 'm2',
			f: 'ada',
			x: '',
			sk: 'heart-eyes',
			d: 1_700_000_000_000
		});
		const body = await (await POST(event({ group: 'g1', sticker: 'heart-eyes' }))).json();
		expect(sendGroupMsgMock).toHaveBeenCalledWith(
			expect.anything(),
			'ada',
			'g1',
			'',
			undefined,
			undefined,
			undefined,
			'heart-eyes',
			undefined
		);
		expect(body.m).toMatchObject({ sk: 'heart-eyes' });
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
		isMemberMock.mockResolvedValue(false);
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
		const err = new Error('qdrant down');
		sendMsgMock.mockRejectedValue(err);
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		await expect(POST(event({ to: 'bob', text: 'hi' }))).rejects.toMatchObject({ status: 503 });
		expect(spy).toHaveBeenCalledWith('[SEND] not_stored', err);
		spy.mockRestore();
	});

	it('503s a group send when send_group_msg rejects', async () => {
		const err = new Error('qdrant down');
		sendGroupMsgMock.mockRejectedValue(err);
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		await expect(POST(event({ group: 'g1', text: 'hi' }))).rejects.toMatchObject({
			status: 503
		});
		expect(spy).toHaveBeenCalledWith('[SEND] not_stored', err);
		spy.mockRestore();
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

	it('threads reply_to into send_msg and returns rp on a 1:1 send', async () => {
		sendMsgMock.mockResolvedValue({
			id: 'm1',
			f: 'ada',
			t: 'bob',
			x: 'hi',
			rp: 'orig-1',
			d: 1_700_000_000_000
		});
		const body = await (await POST(event({ to: 'bob', text: 'hi', reply_to: 'orig-1' }))).json();
		expect(sendMsgMock).toHaveBeenCalledWith(
			expect.anything(),
			'ada',
			'bob',
			'hi',
			undefined,
			undefined,
			'orig-1',
			undefined,
			undefined
		);
		expect(body.m).toMatchObject({ rp: 'orig-1' });
	});

	it('threads reply_to into send_group_msg and returns rp on a group send', async () => {
		sendGroupMsgMock.mockResolvedValue({
			id: 'm2',
			f: 'ada',
			x: 'hi',
			rp: 'orig-2',
			d: 1_700_000_000_000
		});
		const body = await (await POST(event({ group: 'g1', text: 'hi', reply_to: 'orig-2' }))).json();
		expect(sendGroupMsgMock).toHaveBeenCalledWith(
			expect.anything(),
			'ada',
			'g1',
			'hi',
			undefined,
			undefined,
			'orig-2',
			undefined,
			undefined
		);
		expect(body.m).toMatchObject({ rp: 'orig-2' });
	});

	it('omits rp from the response when the stored message has none', async () => {
		const body = await (await POST(event({ to: 'bob', text: 'hi' }))).json();
		expect(body.m).not.toHaveProperty('rp');
	});

	it('threads forwarded into send_msg and returns fw on a 1:1 send', async () => {
		sendMsgMock.mockResolvedValue({
			id: 'm1',
			f: 'ada',
			t: 'bob',
			x: 'hi',
			fw: true,
			d: 1_700_000_000_000
		});
		const body = await (await POST(event({ to: 'bob', text: 'hi', forwarded: true }))).json();
		expect(sendMsgMock).toHaveBeenCalledWith(
			expect.anything(),
			'ada',
			'bob',
			'hi',
			undefined,
			undefined,
			undefined,
			undefined,
			true
		);
		expect(body.m).toMatchObject({ fw: true });
	});

	it('threads forwarded into send_group_msg and returns fw on a group send', async () => {
		sendGroupMsgMock.mockResolvedValue({
			id: 'm2',
			f: 'ada',
			x: 'hi',
			fw: true,
			d: 1_700_000_000_000
		});
		const body = await (await POST(event({ group: 'g1', text: 'hi', forwarded: true }))).json();
		expect(sendGroupMsgMock).toHaveBeenCalledWith(
			expect.anything(),
			'ada',
			'g1',
			'hi',
			undefined,
			undefined,
			undefined,
			undefined,
			true
		);
		expect(body.m).toMatchObject({ fw: true });
	});

	it('omits fw from the response when not forwarding', async () => {
		const body = await (await POST(event({ to: 'bob', text: 'hi' }))).json();
		expect(body.m).not.toHaveProperty('fw');
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
			url: '/chat/ada',
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
			url: '/~g1',
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

	it('carries reply_msg in the 1:1 relay payload when replying', async () => {
		await POST(event({ to: 'bob', text: 'hi', reply_to: 'orig-1' }));
		await settle();
		expect(call_bodies[0]).toMatchObject({ reply_msg: 'orig-1' });
	});

	it('carries reply_msg in the group relay payload when replying, distinct from the routing reply_to key', async () => {
		await POST(event({ group: 'g1', text: 'hi', reply_to: 'orig-2' }));
		await settle();
		expect(call_bodies[0]).toMatchObject({ reply_to: 'g1', reply_msg: 'orig-2' });
	});

	it('omits reply_msg from the relay payload when not replying', async () => {
		await POST(event({ to: 'bob', text: 'hi' }));
		await settle();
		expect(call_bodies[0]).not.toHaveProperty('reply_msg');
	});

	it('carries sticker in the 1:1 relay payload so the recipient renders it', async () => {
		await POST(event({ to: 'bob', sticker: 'wave' }));
		await settle();
		expect(call_bodies[0]).toMatchObject({ sticker: 'wave' });
	});

	it('carries sticker in the group relay payload', async () => {
		await POST(event({ group: 'g1', sticker: 'heart-eyes' }));
		await settle();
		expect(call_bodies[0]).toMatchObject({ sticker: 'heart-eyes' });
	});
});

describe('POST /api/send — sender self-index hub_conv', () => {
	it('writes the sender conv entry with { peer } for a 1:1 send', async () => {
		await POST(event({ to: 'bob', text: 'hi' }));
		await settle();
		expect(call_bodies[1]).toMatchObject({
			conv: 'ada|bob',
			peer: 'bob',
			last: 1_700_000_000_000,
			preview: 'hi'
		});
	});

	it('writes the sender conv entry with { group } for a group send', async () => {
		await POST(event({ group: 'g1', text: 'hi' }));
		await settle();
		expect(call_bodies[1]).toMatchObject({
			conv: 'g:g1',
			group: 'g1',
			last: 1_700_000_000_000,
			preview: 'hi'
		});
	});

	it('a rejected hub_conv does not fail the send response (best-effort contract)', async () => {
		const fetcher = ws();
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		(fetcher.fetch as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce(new Response(JSON.stringify({ delivered: true }), { status: 200 }))
			.mockRejectedValueOnce(new Error('hub down'));
		const res = await POST(event({ to: 'bob', text: 'hi' }, 'ada', fetcher));
		expect(res.status).toBe(200);
		await settle();
		expect(spy).toHaveBeenCalledWith('[HUB-CONV] sender self-index failed', expect.any(Error));
		spy.mockRestore();
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
