import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { searchMock, retrieveOneMock, recordMatchMock, getUserNameMock } = vi.hoisted(() => ({
	searchMock: vi.fn(),
	retrieveOneMock: vi.fn(),
	recordMatchMock: vi.fn(),
	getUserNameMock: vi.fn()
}));

vi.mock('../../../src/lib/server/qdrant', async () => {
	const actual =
		await vi.importActual<typeof import('../../../src/lib/server/qdrant')>(
			'../../../src/lib/server/qdrant'
		);
	return { ...actual, search: searchMock, retrieve_one: retrieveOneMock };
});
vi.mock('../../../src/lib/server/chat', async () => {
	const actual =
		await vi.importActual<typeof import('../../../src/lib/server/chat')>(
			'../../../src/lib/server/chat'
		);
	return { ...actual, record_match: recordMatchMock, get_user_name: getUserNameMock };
});

import { MatchLobby } from '../lobby';

class FakeSocket {
	sent: string[] = [];
	send(data: string) {
		this.sent.push(data);
	}
	close() {}
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
		})
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

function req(url: string, init?: RequestInit) {
	return new Request(url, init);
}

const SECRET = 'shared-secret';
async function tokenFor(uid: string) {
	const raw = new TextEncoder().encode(`${uid}.${SECRET}`);
	const sig = await crypto.subtle.digest('SHA-256', raw);
	return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// the successful 101-upgrade Response construction is workerd-only and throws under Node (see
// hub-do.test.ts) — swallow that; every assertion here is about pre-101 side effects (storage,
// deliver calls) which already happened by the time that throws.
async function connect(lobby: MatchLobby, state: ReturnType<typeof makeState>, uid: string) {
	const t = await tokenFor(uid);
	await lobby
		.fetch(req(`https://dummy/match?uid=${uid}&t=${t}`, { headers: { upgrade: 'websocket' } }))
		.catch(() => {});
	return state.acceptWebSocket.mock.calls.find((c) => c[1][0] === uid)?.[0] as FakeSocket;
}

let env: { SECRET: string; QDRANT_URL: string; QDRANT_KEY: string };

beforeEach(() => {
	vi.clearAllMocks();
	env = { SECRET, QDRANT_URL: 'u', QDRANT_KEY: 'k' };
	getUserNameMock.mockImplementation(async (_e: unknown, uid: string) => `Name-${uid}`);
	retrieveOneMock.mockResolvedValue(null); // no stored vector by default -> FIFO fallback
	searchMock.mockResolvedValue([]);
	recordMatchMock.mockResolvedValue(undefined);
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

describe('MatchLobby.fetch — auth', () => {
	it('denies a connection with a bad token', async () => {
		const state = makeState();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const lobby = new MatchLobby(state as any, env as any);
		const res = await lobby.fetch(
			req('https://dummy/match?uid=alice&t=garbage', { headers: { upgrade: 'websocket' } })
		);
		expect(res.status).toBe(403);
		expect(state.acceptWebSocket).not.toHaveBeenCalled();
	});

	it('rejects non-websocket requests', async () => {
		const state = makeState();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const lobby = new MatchLobby(state as any, env as any);
		const res = await lobby.fetch(req('https://dummy/match'));
		expect(res.status).toBe(400);
	});
});

describe('MatchLobby.fetch — queueing and matching', () => {
	it('the first searcher waits with nobody to match', async () => {
		const state = makeState();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const lobby = new MatchLobby(state as any, env as any);
		const alice = await connect(lobby, state, 'alice');
		expect(JSON.parse(alice.sent[0])).toEqual({ type: 'searching' });
		expect(recordMatchMock).not.toHaveBeenCalled();
		const waiting = await state.storage.get('waiting');
		expect(waiting).toEqual([{ uid: 'alice', name: 'Name-alice' }]);
	});

	it('FIFO-matches the second searcher with the first when nobody has an embedding', async () => {
		const state = makeState();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const lobby = new MatchLobby(state as any, env as any);
		const alice = await connect(lobby, state, 'alice');
		const bob = await connect(lobby, state, 'bob');

		expect(recordMatchMock).toHaveBeenCalledWith(env, 'bob', 'alice');
		expect(JSON.parse(alice.sent.at(-1)!)).toMatchObject({ type: 'matched', peer: 'bob' });
		expect(JSON.parse(bob.sent.at(-1)!)).toMatchObject({ type: 'matched', peer: 'alice' });
		expect(await state.storage.get('waiting')).toEqual([]);
	});

	it('ranks waiting candidates by embedding similarity over FIFO order', async () => {
		const state = makeState();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const lobby = new MatchLobby(state as any, env as any);
		// seed two already-waiting users directly (bypasses fetch()'s auto-match-on-connect, which
		// would otherwise immediately FIFO-pair the second arrival with the first)
		const alice = new FakeSocket();
		const bob = new FakeSocket();
		state.acceptWebSocket(alice, ['alice']);
		state.acceptWebSocket(bob, ['bob']);
		await state.storage.put('waiting', [
			{ uid: 'alice', name: 'Name-alice' },
			{ uid: 'bob', name: 'Name-bob' }
		]);

		retrieveOneMock.mockResolvedValue({ id: 'carol', payload: {}, vector: [1, 0, 0] });
		searchMock.mockResolvedValue([
			{ id: 'not-waiting', score: 0.99 },
			{ id: 'bob', score: 0.8 },
			{ id: 'alice', score: 0.5 }
		]);

		const carol = await connect(lobby, state, 'carol');

		expect(recordMatchMock).toHaveBeenCalledWith(env, 'carol', 'bob');
		expect(JSON.parse(bob.sent.at(-1)!)).toMatchObject({ type: 'matched', peer: 'carol' });
		expect(JSON.parse(carol.sent.at(-1)!)).toMatchObject({ type: 'matched', peer: 'bob' });
		expect(alice.sent).toEqual([]);
		expect((await state.storage.get('waiting') as { uid: string }[]).map((w) => w.uid)).toEqual([
			'alice'
		]);
	});

	it('falls back to FIFO when the searcher has no embedding, even with candidates waiting', async () => {
		const state = makeState();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const lobby = new MatchLobby(state as any, env as any);
		const alice = new FakeSocket();
		const bob = new FakeSocket();
		state.acceptWebSocket(alice, ['alice']);
		state.acceptWebSocket(bob, ['bob']);
		await state.storage.put('waiting', [
			{ uid: 'alice', name: 'Name-alice' },
			{ uid: 'bob', name: 'Name-bob' }
		]);
		retrieveOneMock.mockResolvedValue(null); // carol has no profile vector

		await connect(lobby, state, 'carol');

		expect(recordMatchMock).toHaveBeenCalledWith(env, 'carol', 'alice');
	});

	it('drops stale waiting entries with no live socket and matches a live one instead', async () => {
		const state = makeState();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const lobby = new MatchLobby(state as any, env as any);
		const bob = new FakeSocket();
		state.acceptWebSocket(bob, ['bob']);
		// 'ghost' is in the waiting list but has no registered socket (simulates a disconnect that
		// never got cleaned up)
		await state.storage.put('waiting', [
			{ uid: 'ghost', name: 'Name-ghost' },
			{ uid: 'bob', name: 'Name-bob' }
		]);

		await connect(lobby, state, 'carol');

		expect(recordMatchMock).toHaveBeenCalledWith(env, 'carol', 'bob');
		expect(recordMatchMock).not.toHaveBeenCalledWith(env, 'carol', 'ghost');
	});
});

describe('MatchLobby.webSocketClose', () => {
	it('removes a waiting searcher from the queue on disconnect', async () => {
		const state = makeState();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const lobby = new MatchLobby(state as any, env as any);
		const aliceSocket = await connect(lobby, state, 'alice');
		expect(await state.storage.get('waiting')).toEqual([{ uid: 'alice', name: 'Name-alice' }]);

		await lobby.webSocketClose(aliceSocket as unknown as WebSocket);

		expect(await state.storage.get('waiting')).toEqual([]);
	});

	it('is a no-op for a uid that was never waiting', async () => {
		const state = makeState();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const lobby = new MatchLobby(state as any, env as any);
		const ghost = new FakeSocket();
		state.acceptWebSocket(ghost, ['nobody']);
		await expect(
			lobby.webSocketClose(ghost as unknown as WebSocket)
		).resolves.toBeUndefined();
	});
});
