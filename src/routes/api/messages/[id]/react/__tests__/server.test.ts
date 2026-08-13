import { describe, it, expect, vi, beforeEach } from 'vitest';

const { toggleReactionMock, getMessageMock, isMemberMock, getGroupMock } = vi.hoisted(() => ({
	toggleReactionMock: vi.fn(),
	getMessageMock: vi.fn(),
	isMemberMock: vi.fn(),
	getGroupMock: vi.fn()
}));

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$lib/server/chat', () => ({
	toggle_reaction: toggleReactionMock,
	get_message: getMessageMock
}));
vi.mock('$lib/server/group', () => ({ is_member: isMemberMock, get_group: getGroupMock }));

import { POST } from '../+server';

let bg_tasks: Promise<unknown>[] = [];
function ws() {
	return {
		fetch: vi.fn(
			async (_url: string, _init: { body: string }) => new Response('{}', { status: 200 })
		)
	};
}

function event(
	id: string,
	uid: string | null = 'me',
	fetcher = ws(),
	body: unknown = { emoji: '👍' }
) {
	return {
		params: { id },
		request: new Request('https://x/api/messages/' + id + '/react', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		}),
		locals: {
			user: uid ? { id: uid } : null,
			x2_ws: fetcher,
			bg: (p: Promise<unknown>) => {
				bg_tasks.push(p);
			}
		}
	} as unknown as Parameters<typeof POST>[0];
}

const settle = () => Promise.all(bg_tasks);

beforeEach(() => {
	vi.clearAllMocks();
	bg_tasks = [];
	getMessageMock.mockResolvedValue({ id: 'm1', f: 'a', t: 'me', x: 'hi' });
	toggleReactionMock.mockResolvedValue({ '👍': ['me'] });
	isMemberMock.mockResolvedValue(true);
	getGroupMock.mockResolvedValue({ id: 'g1', members: ['a', 'me', 'bob'] });
});

describe('POST /api/messages/[id]/react', () => {
	it('401s when signed out', async () => {
		await expect(POST(event('m1', null))).rejects.toMatchObject({ status: 401 });
	});
	it('400s without an emoji', async () => {
		await expect(POST(event('m1', 'me', ws(), {}))).rejects.toMatchObject({ status: 400 });
	});
	it('404s when the message does not exist', async () => {
		getMessageMock.mockResolvedValue(null);
		await expect(POST(event('m1'))).rejects.toMatchObject({ status: 404 });
	});
	it('403s a 1:1 message the caller is not a party to', async () => {
		getMessageMock.mockResolvedValue({ id: 'm1', f: 'a', t: 'b', x: 'hi' });
		await expect(POST(event('m1', 'stranger'))).rejects.toMatchObject({ status: 403 });
	});
	it('403s a group message for a non-member', async () => {
		getMessageMock.mockResolvedValue({ id: 'm1', gr: 'g1', f: 'a', t: '', x: 'hi' });
		isMemberMock.mockResolvedValue(false);
		await expect(POST(event('m1', 'stranger'))).rejects.toMatchObject({ status: 403 });
	});
	it('200s, toggles the reaction and relays it to the participants', async () => {
		const fetcher = ws();
		const res = await POST(event('m1', 'me', fetcher));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ rx: { '👍': ['me'] } });
		expect(toggleReactionMock).toHaveBeenCalledWith({}, 'me', 'm1', '👍');
		await settle();
		expect(fetcher.fetch).toHaveBeenCalled();
		const relayBody = JSON.parse(fetcher.fetch.mock.calls[0][1].body);
		expect(relayBody).toMatchObject({ type: 'reaction', id: 'm1', rx: { '👍': ['me'] } });
		expect(relayBody.members).toEqual(['a', 'me']);
	});
	it('relays a group reaction to the group members', async () => {
		getMessageMock.mockResolvedValue({ id: 'm1', gr: 'g1', f: 'a', t: '', x: 'hi' });
		getGroupMock.mockResolvedValue({ id: 'g1', members: ['a', 'me', 'bob'] });
		const fetcher = ws();
		await POST(event('m1', 'me', fetcher));
		await settle();
		const relayBody = JSON.parse(fetcher.fetch.mock.calls[0][1].body);
		expect(relayBody).toMatchObject({
			type: 'reaction',
			id: 'm1',
			rx: { '👍': ['me'] }
		});
		expect(relayBody.members).toEqual(['a', 'me', 'bob']);
	});
});
