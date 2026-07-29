import { describe, it, expect, vi, beforeEach } from 'vitest';

const { sendMsgMock, sendGroupMsgMock, getGroupMock, notifyMock, totalUnreadMock, saveScheduledMock } =
	vi.hoisted(() => ({
		sendMsgMock: vi.fn(),
		sendGroupMsgMock: vi.fn(),
		getGroupMock: vi.fn(),
		notifyMock: vi.fn(),
		totalUnreadMock: vi.fn(),
		saveScheduledMock: vi.fn()
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
vi.mock('$lib/server/scheduled', () => ({ save_scheduled: saveScheduledMock, MIN_LEAD_MS: 60_000 }));

import { POST } from '../+server';

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
			x2_ws: fetcher
		}
	} as unknown as Parameters<typeof POST>[0];
}

const note = () => notifyMock.mock.calls[0];

beforeEach(() => {
	vi.clearAllMocks();
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
		expect(note()[1]).toEqual(['bob']);
	});

	it('does not push when the message was delivered over the socket', async () => {
		await POST(event({ to: 'bob', text: 'hi' }, 'ada', ws({ ok: true, undelivered: [] })));
		expect(notifyMock).not.toHaveBeenCalled();
	});

	it('pushes everyone when the relay itself is unreachable', async () => {
		const broken = ws(new Error('ws down'));
		await POST(event({ to: 'bob', text: 'hi' }, 'ada', broken));
		expect(note()[1]).toEqual(['bob']);
	});

	it('pushes only the group members the relay missed', async () => {
		await POST(
			event({ group: 'g1', text: 'hi' }, 'ada', ws({ ok: true, undelivered: ['cid'] }))
		);
		expect(note()[1]).toEqual(['cid']);
	});

	it('never pushes the sender their own message', async () => {
		await POST(
			event({ group: 'g1', text: 'hi' }, 'ada', ws({ ok: true, undelivered: ['ada', 'cid'] }))
		);
		expect(note()[1]).not.toContain('ada');
	});
});

describe('POST /api/send — what the notification says', () => {
	it('titles a direct message with the sender’s username', async () => {
		await POST(event({ to: 'bob', text: 'hi' }, 'ada', ws({ ok: true, undelivered: ['bob'] })));
		expect(note()[2]).toMatchObject({ title: 'ada', body: 'hi' });
	});

	it('opens the conversation with the sender when tapped', async () => {
		await POST(event({ to: 'bob', text: 'hi' }, 'ada', ws({ ok: true, undelivered: ['bob'] })));
		expect(note()[2].url).toBe('/app/chat/ada');
	});

	it('tags a direct message with its conversation id, so a thread collapses', async () => {
		await POST(event({ to: 'bob', text: 'hi' }, 'ada', ws({ ok: true, undelivered: ['bob'] })));
		expect(note()[2].conv).toBe('ada|bob');
	});

	it('titles a group message with the room and names the speaker in the body', async () => {
		await POST(event({ group: 'g1', text: 'hi' }, 'ada', ws({ ok: true, undelivered: ['bob'] })));
		expect(note()[2]).toMatchObject({ title: 'design club', body: 'ada: hi' });
	});

	it('opens the room when a group notification is tapped', async () => {
		await POST(event({ group: 'g1', text: 'hi' }, 'ada', ws({ ok: true, undelivered: ['bob'] })));
		expect(note()[2]).toMatchObject({ url: '/app/rooms/g1', conv: 'g:g1' });
	});

	it('carries an attached photo so the notification can show it', async () => {
		await POST(
			event({ to: 'bob', image: 'ada/x.png' }, 'ada', ws({ ok: true, undelivered: ['bob'] }))
		);
		expect(note()[2].image).toBe('/media/ada/x.png');
	});

	it('carries the message timestamp and id', async () => {
		await POST(event({ to: 'bob', text: 'hi' }, 'ada', ws({ ok: true, undelivered: ['bob'] })));
		expect(note()[2]).toMatchObject({ id: 'm1', ts: 1_700_000_000_000 });
	});

	it('carries the recipient’s unread total for a direct message, to set the app badge', async () => {
		await POST(event({ to: 'bob', text: 'hi' }, 'ada', ws({ ok: true, undelivered: ['bob'] })));
		expect(totalUnreadMock).toHaveBeenCalledWith(expect.anything(), 'bob');
		expect(note()[2].unread).toBe(3);
	});

	it('skips the per-recipient unread lookup on a group send — the badge increments locally', async () => {
		await POST(
			event({ group: 'g1', text: 'hi' }, 'ada', ws({ ok: true, undelivered: ['bob', 'cid'] }))
		);
		expect(totalUnreadMock).not.toHaveBeenCalled();
		expect(note()[2].unread).toBeUndefined();
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
