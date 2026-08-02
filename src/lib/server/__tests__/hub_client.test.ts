import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getSecretMock } = vi.hoisted(() => ({ getSecretMock: vi.fn() }));
vi.mock('../qdrant', async () => {
	const actual = await vi.importActual<typeof import('../qdrant')>('../qdrant');
	return { ...actual, get_secret: getSecretMock };
});

import {
	hub_unread,
	hub_mark_read,
	hub_mute,
	hub_unmute,
	hub_mutes,
	hub_sub,
	hub_unsub,
	hub_convs,
	ChatHubError,
	room_join,
	room_leave,
	room_members,
	room_is_member
} from '../hub_client';
import type { QEnv } from '../qdrant';

const ENV = { SECRET: 's' } as unknown as QEnv;

function ws(response: unknown, ok = true) {
	return {
		fetch: vi.fn(async () => new Response(JSON.stringify(response), { status: ok ? 200 : 500 }))
	} as unknown as Fetcher;
}

beforeEach(() => {
	vi.clearAllMocks();
	getSecretMock.mockResolvedValue('shared-secret');
});

describe('hub_unread', () => {
	it('calls the uid-scoped hub route with a bearer auth header', async () => {
		const w = ws({ total: 3, by_conv: { 'a|b': 3 } });
		const r = await hub_unread(ENV, w, 'me');
		expect(r).toEqual({ total: 3, by_conv: { 'a|b': 3 } });
		const [url, init] = (w.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
		expect(url).toBe('https://x2-ws/hub/me/unread');
		expect(init.headers.authorization).toBe('Bearer shared-secret');
	});

	it('fails open to zero when the hub is unreachable', async () => {
		const w = { fetch: vi.fn().mockRejectedValue(new Error('down')) } as unknown as Fetcher;
		expect(await hub_unread(ENV, w, 'me')).toEqual({ total: 0, by_conv: {} });
	});

	it('fails open to zero on a non-ok response', async () => {
		const w = ws({}, false);
		expect(await hub_unread(ENV, w, 'me')).toEqual({ total: 0, by_conv: {} });
	});
});

describe('hub_mark_read', () => {
	it('posts the conv and ts, returns the fresh total', async () => {
		const w = ws({ total: 1 });
		const total = await hub_mark_read(ENV, w, 'me', 'a|b', 500);
		expect(total).toBe(1);
		const [url, init] = (w.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
		expect(url).toBe('https://x2-ws/hub/me/read');
		expect(JSON.parse(init.body)).toEqual({ conv: 'a|b', ts: 500 });
	});
});

describe('hub_mute / hub_unmute / hub_mutes', () => {
	it('posts target, kind and until', async () => {
		const w = ws({});
		await hub_mute(ENV, w, 'me', 'bob', 'u', 12345);
		const [, init] = (w.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
		expect(JSON.parse(init.body)).toEqual({ target: 'bob', kind: 'u', until: 12345 });
	});

	it('unmute posts just the target', async () => {
		const w = ws({});
		await hub_unmute(ENV, w, 'me', 'bob');
		const [, init] = (w.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
		expect(JSON.parse(init.body)).toEqual({ target: 'bob' });
	});

	it('returns the mute list from the hub', async () => {
		const w = ws({ mutes: [{ tg: 'bob', k: 'u', until: 0 }] });
		expect(await hub_mutes(ENV, w, 'me')).toEqual([{ tg: 'bob', k: 'u', until: 0 }]);
	});

	it('returns an empty list when the hub is unreachable', async () => {
		const w = { fetch: vi.fn().mockRejectedValue(new Error('down')) } as unknown as Fetcher;
		expect(await hub_mutes(ENV, w, 'me')).toEqual([]);
	});
});

describe('hub_sub / hub_unsub', () => {
	it('posts endpoint and keys under short field names', async () => {
		const w = ws({});
		await hub_sub(ENV, w, 'me', { endpoint: 'https://p', keys: { p256dh: 'P', auth: 'A' } }, 'UA');
		const [, init] = (w.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
		expect(JSON.parse(init.body)).toEqual({ ep: 'https://p', k: 'P', au: 'A', ua: 'UA' });
	});

	it('unsub posts just the endpoint', async () => {
		const w = ws({});
		await hub_unsub(ENV, w, 'me', 'https://p');
		const [, init] = (w.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
		expect(JSON.parse(init.body)).toEqual({ ep: 'https://p' });
	});
});

describe('room_join / room_leave / room_members / room_is_member', () => {
	it('room_join calls POST /room/:id/join with { uid } body', async () => {
		const w = ws({ members: ['alice', 'bob'] });
		const r = await room_join(ENV, w, 'g1', 'bob');
		expect(r).toEqual(['alice', 'bob']);
		const [url, init] = (w.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
		expect(url).toBe('https://x2-ws/room/g1/join');
		expect(init.method).toBe('POST');
		expect(JSON.parse(init.body)).toEqual({ uid: 'bob' });
		expect(init.headers.authorization).toBe('Bearer shared-secret');
	});

	it('room_leave calls POST /room/:id/leave with { uid } body', async () => {
		const w = ws({ members: ['alice'] });
		const r = await room_leave(ENV, w, 'g1', 'bob');
		expect(r).toEqual(['alice']);
		const [url, init] = (w.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
		expect(url).toBe('https://x2-ws/room/g1/leave');
		expect(init.method).toBe('POST');
		expect(JSON.parse(init.body)).toEqual({ uid: 'bob' });
	});

	it('room_members calls GET /room/:id/members', async () => {
		const w = ws({ members: ['alice', 'bob'] });
		const r = await room_members(ENV, w, 'g1');
		expect(r).toEqual(['alice', 'bob']);
		const [url] = (w.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
		expect(url).toBe('https://x2-ws/room/g1/members');
	});

	it('room_is_member calls GET /room/:id/is-member?uid=x', async () => {
		const w = ws({ ok: true });
		expect(await room_is_member(ENV, w, 'g1', 'bob')).toBe(true);
		const [url] = (w.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
		expect(url).toBe('https://x2-ws/room/g1/is-member?uid=bob');
	});

	it('room_is_member returns false when the fetch fails', async () => {
		const w = { fetch: vi.fn().mockRejectedValue(new Error('down')) } as unknown as Fetcher;
		expect(await room_is_member(ENV, w, 'g1', 'bob')).toBe(false);
	});

	it('room_* fails open to empty list when unreachable', async () => {
		const w = { fetch: vi.fn().mockRejectedValue(new Error('down')) } as unknown as Fetcher;
		expect(await room_join(ENV, w, 'g1', 'bob')).toEqual([]);
		expect(await room_leave(ENV, w, 'g1', 'bob')).toEqual([]);
		expect(await room_members(ENV, w, 'g1')).toEqual([]);
	});
});

describe('hub_convs error taxonomy (chats-empty hardening)', () => {
	it('returns convs from a healthy hub', async () => {
		const w = ws({ convs: [{ peer: 'b', last: 1, preview: 'hi' }] });
		const r = await hub_convs(ENV, w, 'me');
		expect(r).toEqual([{ peer: 'b', last: 1, preview: 'hi' }]);
	});

	it('throws ChatHubError(network) when the ws fetch rejects', async () => {
		const w = { fetch: vi.fn().mockRejectedValue(new Error('down')) } as unknown as Fetcher;
		await expect(hub_convs(ENV, w, 'me')).rejects.toMatchObject({ reason: 'network' });
	});

	it('throws ChatHubError(http_<status>) on a non-ok response', async () => {
		const w = ws({}, false);
		await expect(hub_convs(ENV, w, 'me')).rejects.toMatchObject({ reason: 'http_500' });
	});

	it('throws ChatHubError(bad_shape) on a 200 non-JSON body (stale ws worker fallback)', async () => {
		const w = {
			fetch: vi.fn(async () => new Response('x2-ws relay+presence worker', { status: 200 }))
		} as unknown as Fetcher;
		await expect(hub_convs(ENV, w, 'me')).rejects.toMatchObject({ reason: 'bad_shape' });
	});

	it('throws ChatHubError(bad_shape) when .convs is missing from a valid JSON body', async () => {
		const w = ws({ ok: 1 });
		await expect(hub_convs(ENV, w, 'me')).rejects.toMatchObject({ reason: 'bad_shape' });
	});

	it('error instances are ChatHubError so loaders can distinguish them', async () => {
		expect(new ChatHubError('network')).toBeInstanceOf(ChatHubError);
		expect(new ChatHubError('network').reason).toBe('network');
	});
});
