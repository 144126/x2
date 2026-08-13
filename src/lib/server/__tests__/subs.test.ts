import { describe, it, expect, vi, beforeEach } from 'vitest';

const { hubSubMock, hubUnsubMock } = vi.hoisted(() => ({
	hubSubMock: vi.fn(),
	hubUnsubMock: vi.fn()
}));

vi.mock('../hub_client', () => ({ hub_sub: hubSubMock, hub_unsub: hubUnsubMock }));

import type { QEnv } from '../qdrant';
import { save_sub, delete_sub } from '../subs';

const ENV = { QDRANT_URL: 'u', QDRANT_KEY: 'k' } as unknown as QEnv;
const WS = {} as Fetcher;
const web = (endpoint: string) => ({
	endpoint,
	keys: { p256dh: 'BPublicKeyBytes', auth: 'AuthSecret' }
});

beforeEach(() => {
	vi.clearAllMocks();
	hubSubMock.mockResolvedValue(undefined);
	hubUnsubMock.mockResolvedValue(undefined);
});

describe('save_sub', () => {
	it('forwards the subscription and user agent to the hub, scoped to the uid', async () => {
		await save_sub(ENV, WS, 'me', web('https://push.example.net/a'), 'Firefox/1');
		expect(hubSubMock).toHaveBeenCalledWith(
			ENV,
			WS,
			'me',
			web('https://push.example.net/a'),
			'Firefox/1'
		);
	});

	it('rejects a subscription missing its endpoint or keys', async () => {
		await expect(
			save_sub(ENV, WS, 'me', { endpoint: '', keys: { p256dh: 'a', auth: 'b' } })
		).rejects.toThrow();
		expect(hubSubMock).not.toHaveBeenCalled();
	});

	it('rejects an endpoint that is not https', async () => {
		await expect(save_sub(ENV, WS, 'me', web('http://insecure.example.net/a'))).rejects.toThrow();
	});
});

describe('delete_sub', () => {
	it('forwards uid and endpoint to the hub', async () => {
		await delete_sub(ENV, WS, 'me', 'https://push.example.net/a');
		expect(hubUnsubMock).toHaveBeenCalledWith(ENV, WS, 'me', 'https://push.example.net/a');
	});
});
