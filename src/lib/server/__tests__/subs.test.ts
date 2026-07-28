import { describe, it, expect, vi, beforeEach } from 'vitest';

const { ensureMock, upsertMock, scrollMock, removeMock } = vi.hoisted(() => ({
	ensureMock: vi.fn(),
	upsertMock: vi.fn(),
	scrollMock: vi.fn(),
	removeMock: vi.fn()
}));

vi.mock('../qdrant', async () => {
	const actual = await vi.importActual<typeof import('../qdrant')>('../qdrant');
	return {
		...actual,
		ensure: ensureMock,
		upsert: upsertMock,
		scroll: scrollMock,
		remove: removeMock
	};
});

import { uuid_from, type QEnv } from '../qdrant';
import {
	delete_sub,
	delete_subs,
	list_subs,
	list_subs_many,
	save_sub,
	to_web_push,
	type PushSub
} from '../subs';

const env = {} as QEnv;
const web = (endpoint: string) => ({
	endpoint,
	keys: { p256dh: 'BPublicKeyBytes', auth: 'AuthSecret' }
});
const stored = (o: Partial<PushSub>): { id: string; payload: PushSub } => ({
	id: 'x',
	payload: { s: 'ps', f: 'me', ep: 'https://p/1', k: 'K', au: 'A', d: 1, ...o } as PushSub
});

beforeEach(() => {
	vi.clearAllMocks();
	ensureMock.mockResolvedValue(undefined);
	upsertMock.mockResolvedValue(undefined);
	removeMock.mockResolvedValue(undefined);
	scrollMock.mockResolvedValue([]);
});

describe('save_sub', () => {
	it('ensures the collection before writing', async () => {
		await save_sub(env, 'me', web('https://push.example.net/a'));
		expect(ensureMock).toHaveBeenCalled();
	});

	it('stores the subscription keyed by a hash of the endpoint', async () => {
		await save_sub(env, 'me', web('https://push.example.net/a'));
		const [[, points]] = upsertMock.mock.calls;
		expect(points[0].id).toBe(await uuid_from('https://push.example.net/a'));
	});

	it('re-subscribing the same device upserts instead of duplicating', async () => {
		await save_sub(env, 'me', web('https://push.example.net/a'));
		await save_sub(env, 'me', web('https://push.example.net/a'));
		const [first, second] = upsertMock.mock.calls;
		expect(first[1][0].id).toBe(second[1][0].id);
	});

	it('records the owner, endpoint and both keys', async () => {
		await save_sub(env, 'me', web('https://push.example.net/a'));
		expect(upsertMock.mock.calls[0][1][0].payload).toMatchObject({
			s: 'ps',
			f: 'me',
			ep: 'https://push.example.net/a',
			k: 'BPublicKeyBytes',
			au: 'AuthSecret'
		});
	});

	it('timestamps the subscription', async () => {
		const before = Date.now();
		await save_sub(env, 'me', web('https://push.example.net/a'));
		expect(upsertMock.mock.calls[0][1][0].payload.d).toBeGreaterThanOrEqual(before);
	});

	it('keeps the user agent when one is supplied, for a readable device list', async () => {
		await save_sub(env, 'me', web('https://push.example.net/a'), 'Firefox/1');
		expect(upsertMock.mock.calls[0][1][0].payload.ua).toBe('Firefox/1');
	});

	it('rejects a subscription missing its endpoint or keys', async () => {
		await expect(save_sub(env, 'me', { endpoint: '', keys: { p256dh: 'a', auth: 'b' } })).rejects.toThrow();
		await expect(
			save_sub(env, 'me', { endpoint: 'https://p/a', keys: { p256dh: '', auth: 'b' } })
		).rejects.toThrow();
		expect(upsertMock).not.toHaveBeenCalled();
	});

	it('rejects an endpoint that is not https', async () => {
		await expect(save_sub(env, 'me', web('http://push.example.net/a'))).rejects.toThrow();
	});
});

describe('list_subs', () => {
	it('filters to push subscriptions owned by the user', async () => {
		await list_subs(env, 'me');
		const filter = scrollMock.mock.calls[0][1];
		expect(filter.must).toContainEqual({ key: 's', match: { value: 'ps' } });
		expect(filter.must).toContainEqual({ key: 'f', match: { value: 'me' } });
	});

	it('returns the stored payloads', async () => {
		scrollMock.mockResolvedValue([stored({ ep: 'https://p/1' }), stored({ ep: 'https://p/2' })]);
		expect((await list_subs(env, 'me')).map((s) => s.ep)).toEqual(['https://p/1', 'https://p/2']);
	});

	it('returns an empty list when the user has never subscribed', async () => {
		expect(await list_subs(env, 'me')).toEqual([]);
	});
});

describe('list_subs_many', () => {
	it('gathers every recipient in one pass', async () => {
		scrollMock
			.mockResolvedValueOnce([stored({ f: 'a', ep: 'https://p/a' })])
			.mockResolvedValueOnce([stored({ f: 'b', ep: 'https://p/b' })]);
		const subs = await list_subs_many(env, ['a', 'b']);
		expect(subs.map((s) => s.ep).sort()).toEqual(['https://p/a', 'https://p/b']);
	});

	it('does not query at all for an empty recipient list', async () => {
		expect(await list_subs_many(env, [])).toEqual([]);
		expect(scrollMock).not.toHaveBeenCalled();
	});

	it('de-duplicates a device that somehow appears twice', async () => {
		scrollMock
			.mockResolvedValueOnce([stored({ f: 'a', ep: 'https://p/same' })])
			.mockResolvedValueOnce([stored({ f: 'b', ep: 'https://p/same' })]);
		expect(await list_subs_many(env, ['a', 'b'])).toHaveLength(1);
	});
});

describe('delete_sub', () => {
	it('removes the point derived from the endpoint', async () => {
		await delete_sub(env, 'https://push.example.net/a');
		expect(removeMock).toHaveBeenCalledWith(env, [await uuid_from('https://push.example.net/a')]);
	});

	it('deletes a batch of dead endpoints in one call', async () => {
		await delete_subs(env, ['https://p/1', 'https://p/2']);
		expect(removeMock).toHaveBeenCalledWith(env, [
			await uuid_from('https://p/1'),
			await uuid_from('https://p/2')
		]);
	});

	it('does nothing for an empty batch', async () => {
		await delete_subs(env, []);
		expect(removeMock).not.toHaveBeenCalled();
	});
});

describe('to_web_push', () => {
	it('maps a stored record back to the shape the push encoder expects', () => {
		expect(
			to_web_push({ s: 'ps', f: 'me', ep: 'https://p/1', k: 'K', au: 'A', d: 1 })
		).toEqual({ endpoint: 'https://p/1', keys: { p256dh: 'K', auth: 'A' } });
	});
});
