import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
	sendMsgMock,
	sendGroupMsgMock,
	getGroupMock,
	notifyMock,
	totalUnreadMock,
	saveScheduledMock,
	isMutedMock,
	dropMutedMock
} = vi.hoisted(() => ({
	sendMsgMock: vi.fn(),
	sendGroupMsgMock: vi.fn(),
	getGroupMock: vi.fn(),
	notifyMock: vi.fn(),
	totalUnreadMock: vi.fn(),
	saveScheduledMock: vi.fn(),
	isMutedMock: vi.fn(),
	dropMutedMock: vi.fn()
}));

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$lib/server/chat', async () => {
	const actual = await vi.importActual<typeof import('$lib/server/chat')>('$lib/server/chat');
	return { ...actual, send_msg: sendMsgMock, send_group_msg: sendGroupMsgMock };
});
vi.mock('$lib/server/group', async () => {
	const actual = await vi.importActual<typeof import('$lib/server/group')>('$lib/server/group');
	return { ...actual, get_group: getGroupMock };
});
vi.mock('$lib/server/notify', () => ({ notify: notifyMock }));
vi.mock('$lib/server/unread', () => ({ total_unread: totalUnreadMock }));
vi.mock('$lib/server/scheduled', () => ({
	save_scheduled: saveScheduledMock,
	MIN_LEAD_MS: 60_000
}));
vi.mock('$lib/server/mute', () => ({ is_muted: isMutedMock, drop_muted: dropMutedMock }));

import { POST } from '../+server';

let bg_tasks: Promise<unknown>[] = [];
let relay_body: unknown;
function ws(response: unknown = { ok: true, undelivered: [] }) {
	return {
		fetch: vi.fn(async (_url: string, init: { body: string }) => {
			relay_body = JSON.parse(init.body);
			if (response instanceof Error) throw response;
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
			bg: (p: Promise<unknown>) => { bg_tasks.push(p); }
		}
	} as unknown as Parameters<typeof POST>[0];
}

const settle = () => Promise.all(bg_tasks);
const note = () => notifyMock.mock.calls[0];

beforeEach(() => {
	vi.clearAllMocks();
	bg_tasks = [];
	relay_body = undefined;
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
	notifyMock.mockResolvedValue({ sent: 1, pruned: 0 });
	totalUnreadMock.mockResolvedValue(3);
	saveScheduledMock.mockResolvedValue({ id: 'sm1', sent: 0 });
	isMutedMock.mockResolvedValue(false);
	dropMutedMock.mockImplementation((_e, _t, uids: string[]) => Promise.resolve(uids));
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

describe('POST /api/send — existing behaviour still holds', () => {
	it('401s when signed out', async () => {
		await expect(POST(event({ to: 'bob', text: 'hi' }, null))).rejects.toMatchObject({
			status: 401
		});
	});

	it('400s with neither text nor image', async () => {
		await expect(POST(event({ to: 'bob' }))).rejects.toMatchObject({ status: 400 });
	});

	it('still returns the stored message to the sender', async () => {
		const body = await (await POST(event({ to: 'bob', text: 'hi' }))).json();
		expect(body.m).toMatchObject({ id: 'm1', from: 'ada', to: 'bob', text: 'hi' });
	});
});

describe('POST /api/send — push for whoever the socket relay could not reach', () => {
	it('pushes to exactly the recipients the relay reports as undelivered', async () => {
		await POST(event({ to: 'bob', text: 'hi' }, 'ada', ws({ ok: true, undelivered: ['bob'] })));
		await settle();
		expect(note()[1]).toEqual(['bob']);
	});

	it('does not push when the message was delivered over the socket', async () => {
		await POST(event({ to: 'bob', text: 'hi' }, 'ada', ws({ ok: true, undelivered: [] })));
		await settle();
		expect(notifyMock).not.toHaveBeenCalled();
	});

	it('pushes everyone when the relay itself is unreachable', async () => {
		const broken = ws(new Error('ws down'));
		await POST(event({ to: 'bob', text: 'hi' }, 'ada', broken));
		await settle();
		expect(note()[1]).toEqual(['bob']);
	});

	it('pushes only the group members the relay missed', async () => {
		await POST(event({ group: 'g1', text: 'hi' }, 'ada', ws({ ok: true, undelivered: ['cid'] })));
		await settle();
		expect(note()[1]).toEqual(['cid']);
	});

	it('never pushes the sender their own message', async () => {
		await POST(
			event({ group: 'g1', text: 'hi' }, 'ada', ws({ ok: true, undelivered: ['ada', 'cid'] }))
		);
		await settle();
		expect(note()[1]).not.toContain('ada');
	});
});

describe('POST /api/send — what the notification says', () => {
	it('titles a direct message with the sender’s username', async () => {
		await POST(event({ to: 'bob', text: 'hi' }, 'ada', ws({ ok: true, undelivered: ['bob'] })));
		await settle();
		expect(note()[2]).toMatchObject({ title: 'ada', body: 'hi' });
	});

	it('opens the conversation with the sender when tapped', async () => {
		await POST(event({ to: 'bob', text: 'hi' }, 'ada', ws({ ok: true, undelivered: ['bob'] })));
		await settle();
		expect(note()[2].url).toBe('/app/chat/ada');
	});

	it('tags a direct message with its conversation id, so a thread collapses', async () => {
		await POST(event({ to: 'bob', text: 'hi' }, 'ada', ws({ ok: true, undelivered: ['bob'] })));
		await settle();
		expect(note()[2].conv).toBe('ada|bob');
	});

	it('titles a group message with the room and names the speaker in the body', async () => {
		await POST(event({ group: 'g1', text: 'hi' }, 'ada', ws({ ok: true, undelivered: ['bob'] })));
		await settle();
		expect(note()[2]).toMatchObject({ title: 'design club', body: 'ada: hi' });
	});

	it('opens the room when a group notification is tapped', async () => {
		await POST(event({ group: 'g1', text: 'hi' }, 'ada', ws({ ok: true, undelivered: ['bob'] })));
		await settle();
		expect(note()[2]).toMatchObject({ url: '/app/rooms/g1', conv: 'g:g1' });
	});

	it('carries an attached photo so the notification can show it', async () => {
		await POST(
			event({ to: 'bob', image: 'ada/x.png' }, 'ada', ws({ ok: true, undelivered: ['bob'] }))
		);
		await settle();
		expect(note()[2].image).toBe('/media/ada/x.png');
	});

	it('carries the message timestamp and id', async () => {
		await POST(event({ to: 'bob', text: 'hi' }, 'ada', ws({ ok: true, undelivered: ['bob'] })));
		await settle();
		expect(note()[2]).toMatchObject({ id: 'm1', ts: 1_700_000_000_000 });
	});

	it('carries the recipient’s unread total for a direct message, to set the app badge', async () => {
		await POST(event({ to: 'bob', text: 'hi' }, 'ada', ws({ ok: true, undelivered: ['bob'] })));
		await settle();
		expect(totalUnreadMock).toHaveBeenCalledWith(expect.anything(), 'bob');
		expect(note()[2].unread).toBe(3);
	});

	it("includes the recipient's unread total in a room push", async () => {
		await POST(event({ group: 'g1', text: 'hi' }, 'ada', ws({ ok: true, undelivered: ['bob'] })));
		await settle();
		expect(totalUnreadMock).toHaveBeenCalledWith(expect.anything(), 'bob', ['g:g1']);
		expect(note()[2].unread).toBe(3);
	});

	it('computes unread per recipient, not once for the room', async () => {
		totalUnreadMock.mockResolvedValueOnce(2).mockResolvedValueOnce(5);
		await POST(
			event({ group: 'g1', text: 'hi' }, 'ada', ws({ ok: true, undelivered: ['bob', 'cid'] }))
		);
		await settle();
		expect(totalUnreadMock).toHaveBeenCalledTimes(2);
		expect(notifyMock).toHaveBeenCalledTimes(2);
		const calls = notifyMock.mock.calls;
		expect(calls[0][2].unread).toBe(2);
		expect(calls[1][2].unread).toBe(5);
	});

	it('still includes unread in a 1:1 push', async () => {
		await POST(event({ to: 'bob', text: 'hi' }, 'ada', ws({ ok: true, undelivered: ['bob'] })));
		await settle();
		expect(totalUnreadMock).toHaveBeenCalledWith(expect.anything(), 'bob');
		expect(note()[2].unread).toBe(3);
	});

	it('includes kind and reply_to in both push payloads', async () => {
		await POST(event({ group: 'g1', text: 'hi' }, 'ada', ws({ ok: true, undelivered: ['bob'] })));
		await settle();
		expect(note()[2]).toMatchObject({ kind: 'r', reply_to: 'g1' });

		await POST(event({ to: 'bob', text: 'hi' }, 'ada', ws({ ok: true, undelivered: ['bob'] })));
		await settle();
		expect(notifyMock.mock.calls[1][2]).toMatchObject({ kind: 'u', reply_to: 'ada' });
	});
});

describe('POST /api/send — push must never break sending', () => {
	it('still returns the message when the push layer throws', async () => {
		notifyMock.mockRejectedValue(new Error('vapid exploded'));
		const res = await POST(
			event({ to: 'bob', text: 'hi' }, 'ada', ws({ ok: true, undelivered: ['bob'] }))
		);
		expect((await res.json()).ok).toBe(true);
	});

	it('still relays over the socket exactly as before', async () => {
		await POST(event({ to: 'bob', text: 'hi' }));
		expect(relay_body).toMatchObject({ to: 'bob', from: 'ada', from_name: 'ada', text: 'hi' });
	});

	it('tolerates a relay response that is not the new JSON shape', async () => {
		const legacy = { fetch: vi.fn(async () => new Response('ok', { status: 200 })) };
		const res = await POST(event({ to: 'bob', text: 'hi' }, 'ada', legacy));
		expect((await res.json()).ok).toBe(true);
	});
});

describe('POST /api/send — mutes suppress push at every send path', () => {
	it('does not push to a recipient who muted the sender', async () => {
		isMutedMock.mockResolvedValue(true);
		await POST(event({ to: 'bob', text: 'hi' }, 'ada', ws({ ok: true, undelivered: ['bob'] })));
		await settle();
		expect(notifyMock).not.toHaveBeenCalled();
	});

	it('still pushes when the recipient muted someone else', async () => {
		isMutedMock.mockResolvedValue(false);
		await POST(event({ to: 'bob', text: 'hi' }, 'ada', ws({ ok: true, undelivered: ['bob'] })));
		await settle();
		expect(notifyMock).toHaveBeenCalledTimes(1);
	});

	it('still relays the message over the socket to a muted recipient', async () => {
		isMutedMock.mockResolvedValue(true);
		await POST(event({ to: 'bob', text: 'hi' }, 'ada', ws({ ok: true, undelivered: ['bob'] })));
		expect(relay_body).toMatchObject({ to: 'bob', from: 'ada', text: 'hi' });
	});

	it('drops muted members from the room push fan-out', async () => {
		dropMutedMock.mockImplementation((_e, _t, uids: string[]) =>
			Promise.resolve((uids as string[]).filter((u) => u !== 'bob'))
		);
		await POST(
			event({ group: 'g1', text: 'hi' }, 'ada', ws({ ok: true, undelivered: ['bob', 'cid'] }))
		);
		await settle();
		expect(notifyMock.mock.calls[0][1]).toEqual(['cid']);
	});

	it('still pushes to unmuted members when some muted the room', async () => {
		dropMutedMock.mockImplementation((_e, _t, uids: string[]) =>
			Promise.resolve((uids as string[]).filter((u) => u !== 'bob'))
		);
		await POST(
			event({ group: 'g1', text: 'hi' }, 'ada', ws({ ok: true, undelivered: ['bob', 'cid'] }))
		);
		await settle();
		expect(notifyMock).toHaveBeenCalledTimes(1);
	});

	it('does not push at all when every offline member muted the room', async () => {
		dropMutedMock.mockResolvedValue([]);
		await POST(
			event({ group: 'g1', text: 'hi' }, 'ada', ws({ ok: true, undelivered: ['bob', 'cid'] }))
		);
		await settle();
		expect(notifyMock).not.toHaveBeenCalled();
	});
});

describe('POST /api/send — background fan-out behaviour', () => {
	it('response does not wait on the fan-out', async () => {
		notifyMock.mockReturnValue(new Promise(() => {}));
		const res = await POST(
			event({ to: 'bob', text: 'hi' }, 'ada', ws({ ok: true, undelivered: ['bob'] }))
		);
		const body = await res.json();
		expect(body).toMatchObject({ ok: true, m: { id: 'm1' } });
	});

	it('registers exactly one background task per send', async () => {
		await POST(event({ to: 'bob', text: 'hi' }, 'ada', ws({ ok: true, undelivered: ['bob'] })));
		expect(bg_tasks).toHaveLength(1);
	});

	it('a throwing relay does not reject the handler', async () => {
		const res = await POST(
			event({ to: 'bob', text: 'hi' }, 'ada', ws(new Error('relay down')))
		);
		expect(res.status).toBe(200);
		await settle();
		expect(notifyMock).toHaveBeenCalled();
	});
});
