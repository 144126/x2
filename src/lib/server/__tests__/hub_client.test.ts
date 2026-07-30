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
	hub_unsub
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
