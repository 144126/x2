import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { searchMock, retrieveOneMock, getUserNameMock } = vi.hoisted(() => ({
	searchMock: vi.fn(),
	retrieveOneMock: vi.fn(),
	getUserNameMock: vi.fn()
}));

vi.mock('../../../src/lib/server/qdrant', async () => {
	const actual = await vi.importActual<typeof import('../../../src/lib/server/qdrant')>(
		'../../../src/lib/server/qdrant'
	);
	return { ...actual, search: searchMock, retrieve_one: retrieveOneMock };
});
vi.mock('../../../src/lib/server/chat', async () => {
	const actual = await vi.importActual<typeof import('../../../src/lib/server/chat')>(
		'../../../src/lib/server/chat'
	);
	return { ...actual, get_user_name: getUserNameMock };
});

import { MatchLobby } from '../lobby';

class FakeSocket {
	sent: string[] = [];
	send(data: string) {
		this.sent.push(data);
	}
	close() {}
	last() {
		return JSON.parse(this.sent.at(-1)!);
	}
	ofType(type: string) {
		return this.sent.map((s) => JSON.parse(s)).filter((m) => m.type === type);
	}
}

function makeStorage() {
	const store = new Map<string, unknown>();
	return {
		get: vi.fn(async (key: string) => store.get(key)),
		put: vi.fn(async (key: string, value: unknown) => {
			store.set(key, value);
		}),
		delete: vi.fn(async (key: string) => {
			store.delete(key);
		}),
		setAlarm: vi.fn(async () => {}),
		deleteAlarm: vi.fn(async () => {})
	};
}

/** records every push the lobby asks ChatHub to send */
function makeHub() {
	const pushed: { uid: string; body: Record<string, unknown> }[] = [];
	return {
		pushed,
		ns: {
			idFromName: (n: string) => n,
			get: (uid: unknown) => ({
				fetch: async (r: Request) => {
					pushed.push({ uid: String(uid), body: await r.json() });
					return new Response('ok');
				}
			})
		}
	};
}

function makeState() {
	const socketsByTag = new Map<string, FakeSocket[]>();
	const allSockets: FakeSocket[] = [];
	const tagsBySocket = new Map<FakeSocket, string[]>();
	return {
		acceptWebSocket: vi.fn((ws: FakeSocket, tags: string[]) => {
			allSockets.push(ws);
			tagsBySocket.set(ws, tags);
			for (const t of tags) socketsByTag.set(t, [...(socketsByTag.get(t) ?? []), ws]);
		}),
		getWebSockets: vi.fn((tag?: string) => (tag ? (socketsByTag.get(tag) ?? []) : allSockets)),
		getTags: vi.fn((ws: FakeSocket) => tagsBySocket.get(ws) ?? []),
		storage: makeStorage()
	};
}

const SECRET = 'shared-secret-that-is-long-enough';
const EXP = Date.now() + 60_000;

async function tokenFor(uid: string) {
	const k = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(SECRET).slice(0, 32),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	const sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(`${uid}.${EXP}`));
	return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// the successful 101-upgrade Response construction is workerd-only and throws under Node (see
// hub-do.test.ts) — swallow that; every assertion here is about pre-101 side effects (storage,
// deliver calls) which already happened by the time that throws.
async function connect(lobby: MatchLobby, state: ReturnType<typeof makeState>, uid: string) {
	const t = await tokenFor(uid);
	await lobby
		.fetch(
			new Request(`https://dummy/match?uid=${uid}&t=${t}&exp=${EXP}`, {
				headers: { upgrade: 'websocket' }
			})
		)
		.catch(() => {});
	return state.acceptWebSocket.mock.calls.find((c) => c[1][0] === uid)?.[0] as FakeSocket;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function makeLobby(state: ReturnType<typeof makeState>, env: unknown) {
	return new MatchLobby(state as any, env as any);
}

let env: { SECRET: string; QDRANT_URL: string; QDRANT_KEY: string; CHAT_HUB: unknown };
let hub: ReturnType<typeof makeHub>;

beforeEach(() => {
	vi.clearAllMocks();
	hub = makeHub();
	env = { SECRET, QDRANT_URL: 'u', QDRANT_KEY: 'k', CHAT_HUB: hub.ns };
	getUserNameMock.mockImplementation(async (_e: unknown, uid: string) => `Name-${uid}`);
	retrieveOneMock.mockResolvedValue(null); // no stored vector by default -> FIFO fallback
	searchMock.mockResolvedValue([]);
	vi.stubGlobal(
		'WebSocketPair',
		class {
			0 = new FakeSocket();
			1 = new FakeSocket();
		}
	);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('MatchLobby — auth', () => {
	it('denies a connection with a bad token', async () => {
		const state = makeState();
		const res = await makeLobby(state, env).fetch(
			new Request(`https://dummy/match?uid=alice&t=garbage&exp=${EXP}`, {
				headers: { upgrade: 'websocket' }
			})
		);
		expect(res.status).toBe(403);
		expect(state.acceptWebSocket).not.toHaveBeenCalled();
	});

	it('denies a token that has expired', async () => {
		const state = makeState();
		const t = await tokenFor('alice');
		const res = await makeLobby(state, env).fetch(
			new Request(`https://dummy/match?uid=alice&t=${t}&exp=1`, {
				headers: { upgrade: 'websocket' }
			})
		);
		expect(res.status).toBe(403);
	});

	it('rejects a non-websocket request', async () => {
		const state = makeState();
		const res = await makeLobby(state, env).fetch(new Request('https://dummy/match'));
		expect(res.status).toBe(400);
	});
});

describe('MatchLobby — queueing and matching', () => {
	it('the first searcher waits alone and is told how many are looking', async () => {
		const state = makeState();
		const lobby = makeLobby(state, env);
		const alice = await connect(lobby, state, 'alice');
		expect(alice.ofType('searching')).toEqual([{ type: 'searching', n: 1 }]);
		expect(await state.storage.get('waiting')).toEqual([
			{ uid: 'alice', name: 'Name-alice', avoid: [] }
		]);
	});

	it('pairs the second searcher with the first when nobody has an embedding', async () => {
		const state = makeState();
		const lobby = makeLobby(state, env);
		const alice = await connect(lobby, state, 'alice');
		const bob = await connect(lobby, state, 'bob');

		expect(alice.last()).toMatchObject({ type: 'matched', peer: 'bob', peer_name: 'Name-bob' });
		expect(bob.last()).toMatchObject({ type: 'matched', peer: 'alice' });
		expect(alice.last().conv).toBe(bob.last().conv);
		expect(await state.storage.get('waiting')).toEqual([]);
	});

	it('ranks waiting candidates by embedding similarity over arrival order', async () => {
		const state = makeState();
		const lobby = makeLobby(state, env);
		// seed two already-waiting users directly (bypasses the auto-match on connect, which
		// would otherwise immediately pair the second arrival with the first)
		const alice = new FakeSocket();
		const bob = new FakeSocket();
		state.acceptWebSocket(alice, ['alice']);
		state.acceptWebSocket(bob, ['bob']);
		await state.storage.put('waiting', [
			{ uid: 'alice', name: 'Name-alice', avoid: [] },
			{ uid: 'bob', name: 'Name-bob', avoid: [] }
		]);

		retrieveOneMock.mockResolvedValue({ id: 'carol', payload: {}, vector: [1, 0, 0] });
		searchMock.mockResolvedValue([
			{ id: 'not-waiting', score: 0.99 },
			{ id: 'bob', score: 0.8 },
			{ id: 'alice', score: 0.5 }
		]);

		const carol = await connect(lobby, state, 'carol');

		expect(carol.last()).toMatchObject({ type: 'matched', peer: 'bob' });
		expect(bob.last()).toMatchObject({ type: 'matched', peer: 'carol' });
		expect(alice.ofType('matched')).toEqual([]);
		expect(((await state.storage.get('waiting')) as { uid: string }[]).map((w) => w.uid)).toEqual([
			'alice'
		]);
	});

	it('reports the interests both people share', async () => {
		const state = makeState();
		const lobby = makeLobby(state, env);
		retrieveOneMock.mockImplementation(async (_e: unknown, id: string) => ({
			id,
			payload: { i: id === 'alice' ? ['Chess', 'jazz'] : ['jazz', 'running'] }
		}));
		const alice = await connect(lobby, state, 'alice');
		const bob = await connect(lobby, state, 'bob');
		expect(alice.last().shared).toEqual(['jazz']);
		expect(bob.last().shared).toEqual(['jazz']);
	});

	it('never pairs anyone with a queue entry whose socket is gone', async () => {
		const state = makeState();
		const lobby = makeLobby(state, env);
		const bob = new FakeSocket();
		state.acceptWebSocket(bob, ['bob']);
		await state.storage.put('waiting', [
			{ uid: 'ghost', name: 'Name-ghost', avoid: [] },
			{ uid: 'bob', name: 'Name-bob', avoid: [] }
		]);

		const carol = await connect(lobby, state, 'carol');
		expect(carol.last()).toMatchObject({ type: 'matched', peer: 'bob' });
	});
});

describe('MatchLobby — next and stop', () => {
	it('"again" re-queues the searcher and skips the person they just left', async () => {
		const state = makeState();
		const lobby = makeLobby(state, env);
		const alice = await connect(lobby, state, 'alice');
		const bob = await connect(lobby, state, 'bob');
		expect(bob.last()).toMatchObject({ type: 'matched', peer: 'alice' });

		// alice goes back in the queue, then bob asks for someone new: alice is skipped
		await lobby.webSocketMessage(alice as unknown as WebSocket, JSON.stringify({ type: 'again' }));
		await lobby.webSocketMessage(
			bob as unknown as WebSocket,
			JSON.stringify({ type: 'again', skip: 'alice' })
		);

		expect(bob.last()).toMatchObject({ type: 'searching' });
		const waiting = (await state.storage.get('waiting')) as { uid: string; avoid: string[] }[];
		expect(waiting.map((w) => w.uid).sort()).toEqual(['alice', 'bob']);
		expect(waiting.find((w) => w.uid === 'bob')!.avoid).toEqual(['alice']);
	});

	it('"stop" takes the searcher out of the queue', async () => {
		const state = makeState();
		const lobby = makeLobby(state, env);
		const alice = await connect(lobby, state, 'alice');
		await lobby.webSocketMessage(alice as unknown as WebSocket, JSON.stringify({ type: 'stop' }));
		expect(await state.storage.get('waiting')).toEqual([]);
	});

	it('a disconnect removes a waiting searcher', async () => {
		const state = makeState();
		const lobby = makeLobby(state, env);
		const alice = await connect(lobby, state, 'alice');
		expect(await state.storage.get('waiting')).toHaveLength(1);
		await lobby.webSocketClose(alice as unknown as WebSocket);
		expect(await state.storage.get('waiting')).toEqual([]);
	});

	it('everyone still waiting is told the queue size when it changes', async () => {
		const state = makeState();
		const lobby = makeLobby(state, env);
		const alice = await connect(lobby, state, 'alice');
		const bob = await connect(lobby, state, 'bob');
		await lobby.webSocketMessage(alice as unknown as WebSocket, JSON.stringify({ type: 'again' }));
		await lobby.webSocketMessage(bob as unknown as WebSocket, JSON.stringify({ type: 'again' }));
		// bob's "again" matched him straight back to alice, so both know a match happened
		expect(bob.last().type).toBe('matched');
		expect(alice.ofType('waiting').length).toBeGreaterThan(0);
	});
});

describe('MatchLobby — parking and waking', () => {
	async function park(lobby: MatchLobby, sock: FakeSocket, tz?: string) {
		await lobby.webSocketMessage(
			sock as unknown as WebSocket,
			JSON.stringify({ type: 'park', ...(tz ? { tz } : {}) })
		);
	}

	it('confirms a park and keeps the person in the queue', async () => {
		const state = makeState();
		const lobby = makeLobby(state, env);
		const alice = await connect(lobby, state, 'alice');
		await park(lobby, alice);
		expect(alice.ofType('parked')).toHaveLength(1);
		expect(await state.storage.get('waiting')).toHaveLength(1);
		expect(((await state.storage.get('park')) as { uid: string }[]).map((p) => p.uid)).toEqual([
			'alice'
		]);
	});

	it('never pings someone who is sitting on the page', async () => {
		const state = makeState();
		const lobby = makeLobby(state, env);
		const alice = await connect(lobby, state, 'alice');
		await park(lobby, alice);
		expect(hub.pushed).toEqual([]);
	});

	it('wakes two parked people at once so they can match each other', async () => {
		const state = makeState();
		const lobby = makeLobby(state, env);
		// both parked and both gone from the page
		await state.storage.put('park', [
			{ uid: 'alice', at: Date.now() },
			{ uid: 'bob', at: Date.now() }
		]);
		const carol = await connect(lobby, state, 'carol');
		await lobby.webSocketMessage(carol as unknown as WebSocket, JSON.stringify({ type: 'stop' }));
		await lobby.alarm();

		expect(hub.pushed.map((p) => p.uid).sort()).toEqual(['alice', 'bob']);
		expect(hub.pushed[0].body).toMatchObject({ url: '/?talk=1' });
	});

	it('wakes nobody when only one person is parked and nobody is searching', async () => {
		const state = makeState();
		const lobby = makeLobby(state, env);
		await state.storage.put('park', [{ uid: 'alice', at: Date.now() }]);
		await lobby.alarm();
		expect(hub.pushed).toEqual([]);
	});

	it('wakes a single parked person once somebody is actually searching', async () => {
		const state = makeState();
		const lobby = makeLobby(state, env);
		await state.storage.put('park', [{ uid: 'alice', at: Date.now() }]);
		await connect(lobby, state, 'carol'); // carol waits, so one arrival is enough
		expect(hub.pushed.map((p) => p.uid)).toEqual(['alice']);
	});

	it('wakes at most two people, never the whole park', async () => {
		const state = makeState();
		const lobby = makeLobby(state, env);
		await state.storage.put(
			'park',
			['a', 'b', 'c', 'd', 'e'].map((uid) => ({ uid, at: Date.now() }))
		);
		await lobby.alarm();
		expect(hub.pushed).toHaveLength(2);
	});

	it('does not ping the same person twice inside the cooldown', async () => {
		const state = makeState();
		const lobby = makeLobby(state, env);
		await state.storage.put('park', [
			{ uid: 'alice', at: Date.now(), pinged: Date.now() },
			{ uid: 'bob', at: Date.now(), pinged: Date.now() }
		]);
		await lobby.alarm();
		expect(hub.pushed).toEqual([]);
	});

	it('stays quiet in the middle of the night where they are', async () => {
		const state = makeState();
		const lobby = makeLobby(state, env);
		// 03:00 in Tokyo is 18:00 UTC the previous day; pick a fixed instant to be sure
		vi.setSystemTime(new Date('2026-08-13T18:00:00Z'));
		await state.storage.put('park', [
			{ uid: 'alice', at: Date.now(), tz: 'Asia/Tokyo' },
			{ uid: 'bob', at: Date.now(), tz: 'Asia/Tokyo' }
		]);
		await lobby.alarm();
		expect(hub.pushed).toEqual([]);
		vi.useRealTimers();
	});

	it('forgets a park that is a day old', async () => {
		const state = makeState();
		const lobby = makeLobby(state, env);
		const old = Date.now() - 25 * 3600_000;
		await state.storage.put('park', [
			{ uid: 'alice', at: old },
			{ uid: 'bob', at: old }
		]);
		await lobby.alarm();
		expect(hub.pushed).toEqual([]);
		expect(await state.storage.get('park')).toEqual([]);
	});

	it('drops the park when the person comes back and connects', async () => {
		const state = makeState();
		const lobby = makeLobby(state, env);
		await state.storage.put('park', [{ uid: 'alice', at: Date.now() }]);
		await connect(lobby, state, 'alice');
		expect(await state.storage.get('park')).toEqual([]);
	});

	it('unpark removes them without waiting for a reconnect', async () => {
		const state = makeState();
		const lobby = makeLobby(state, env);
		const alice = await connect(lobby, state, 'alice');
		await park(lobby, alice);
		await lobby.webSocketMessage(alice as unknown as WebSocket, JSON.stringify({ type: 'unpark' }));
		expect(await state.storage.get('park')).toEqual([]);
	});

	it('a failing push never breaks the sweep', async () => {
		const state = makeState();
		const broken = {
			idFromName: (n: string) => n,
			get: () => ({
				fetch: async () => {
					throw new Error('hub down');
				}
			})
		};
		const lobby = makeLobby(state, { ...env, CHAT_HUB: broken });
		await state.storage.put('park', [
			{ uid: 'alice', at: Date.now() },
			{ uid: 'bob', at: Date.now() }
		]);
		await expect(lobby.alarm()).resolves.toBeUndefined();
	});
});
