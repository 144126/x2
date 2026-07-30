import { describe, it, expect, vi, beforeEach } from 'vitest';

const { hubMuteMock, hubUnmuteMock, hubMutesMock } = vi.hoisted(() => ({
	hubMuteMock: vi.fn(),
	hubUnmuteMock: vi.fn(),
	hubMutesMock: vi.fn()
}));

vi.mock('../hub_client', () => ({
	hub_mute: hubMuteMock,
	hub_unmute: hubUnmuteMock,
	hub_mutes: hubMutesMock
}));

import type { QEnv } from '../qdrant';
import { mute, unmute, is_muted, list_mutes } from '../mute';

const ENV = { QDRANT_URL: 'u', QDRANT_KEY: 'k' } as unknown as QEnv;
const WS = {} as Fetcher;

beforeEach(() => {
	vi.clearAllMocks();
	hubMuteMock.mockResolvedValue(undefined);
	hubUnmuteMock.mockResolvedValue(undefined);
	hubMutesMock.mockResolvedValue([]);
});

describe('mute()', () => {
	it('forwards owner, target, kind and until to the hub', async () => {
		await mute(ENV, WS, 'ada', 'bob', 'u', 5000);
		expect(hubMuteMock).toHaveBeenCalledWith(ENV, WS, 'ada', 'bob', 'u', 5000);
	});

	it('defaults until to 0 (forever)', async () => {
		await mute(ENV, WS, 'ada', 'bob', 'u');
		expect(hubMuteMock).toHaveBeenCalledWith(ENV, WS, 'ada', 'bob', 'u', 0);
	});

	it('returns the mute record it just wrote', async () => {
		const m = await mute(ENV, WS, 'ada', 'bob', 'r', 0);
		expect(m).toMatchObject({ s: 'mu', ow: 'ada', tg: 'bob', k: 'r', until: 0 });
	});
});

describe('unmute()', () => {
	it('forwards owner and target to the hub', async () => {
		await unmute(ENV, WS, 'ada', 'bob');
		expect(hubUnmuteMock).toHaveBeenCalledWith(ENV, WS, 'ada', 'bob');
	});
});

describe('list_mutes()', () => {
	it('maps the hub response onto the Mute shape', async () => {
		hubMutesMock.mockResolvedValue([{ tg: 'bob', k: 'u', until: 0 }]);
		const mutes = await list_mutes(ENV, WS, 'ada');
		expect(mutes).toEqual([{ s: 'mu', ow: 'ada', tg: 'bob', k: 'u', until: 0, d: 0 }]);
	});
});

describe('is_muted()', () => {
	it('is true when the target appears in the owner’s active mutes', async () => {
		hubMutesMock.mockResolvedValue([{ tg: 'bob', k: 'u', until: 0 }]);
		expect(await is_muted(ENV, WS, 'ada', 'bob')).toBe(true);
	});

	it('is false when the target is not muted', async () => {
		hubMutesMock.mockResolvedValue([]);
		expect(await is_muted(ENV, WS, 'ada', 'eve')).toBe(false);
	});
});
