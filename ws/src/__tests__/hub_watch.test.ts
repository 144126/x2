import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChatHub, MAX_WATCHERS } from '../hub';

class FakeReqRespPair {
	constructor(
		public request: string,
		public response: string
	) {}
}

class FakeSocket {
	sent: string[] = [];
	closed = false;
	_att: { active?: boolean } | null = null;
	send(d: string) {
		this.sent.push(d);
	}
	close() {
		this.closed = true;
	}
	serializeAttachment(a: { active?: boolean }) {
		this._att = a;
	}
	deserializeAttachment() {
		return this._att;
	}
}

function makeState() {
	const store = new Map<string, unknown>();
	const tags = new Map<FakeSocket, string[]>();
	const all: FakeSocket[] = [];
	return {
		tag: (ws: FakeSocket, t: string[]) => {
			tags.set(ws, t);
			all.push(ws);
		},
		acceptWebSocket: vi.fn(),
		getWebSockets: vi.fn((tag?: string) =>
			(tag ? all.filter((s) => (tags.get(s) ?? []).includes(tag)) : all).filter((s) => !s.closed)
		),
		getTags: vi.fn((ws: FakeSocket) => tags.get(ws) ?? []),
		setWebSocketAutoResponse: vi.fn(),
		storage: {
			get: vi.fn(async (k: string) => store.get(k)),
			put: vi.fn(async (k: string, v: unknown) => {
				store.set(k, v);
			}),
			delete: vi.fn(async (k: string) => {
				store.delete(k);
			}),
			list: vi.fn(async () => new Map())
		},
		_store: store
	};
}

const req = (path: string, init?: RequestInit) => new Request(`https://dummy${path}`, init);

describe('ChatHub presence watching', () => {
	let state: ReturnType<typeof makeState>;
	let stubFetch: ReturnType<typeof vi.fn>;
	let hub: ChatHub;

	beforeEach(() => {
		vi.stubGlobal('WebSocketRequestResponsePair', FakeReqRespPair);
		state = makeState();
		stubFetch = vi.fn(async () => new Response('ok'));
		const env = {
			CHAT_HUB: { idFromName: (n: string) => n, get: () => ({ fetch: stubFetch }) },
			SECRET: 's'
		};
		hub = new ChatHub(state as never, env as never);
	});

	const paths = () => stubFetch.mock.calls.map((c) => new URL(c[0] as string).pathname);

	it('a watch message subscribes instead of unsubscribing', async () => {
		const ws = new FakeSocket();
		state.tag(ws, ['alice']);
		await hub.webSocketMessage(ws as never, JSON.stringify({ type: 'watch', peer: 'bob' }));
		expect(paths()).toEqual(['/watch']);
	});

	it('a watch message sends the watcher own id', async () => {
		const ws = new FakeSocket();
		state.tag(ws, ['alice']);
		await hub.webSocketMessage(ws as never, JSON.stringify({ type: 'watch', peer: 'bob' }));
		expect(JSON.parse(stubFetch.mock.calls[0][1].body as string)).toEqual({ uid: 'alice' });
	});

	it('an unwatch message unsubscribes', async () => {
		const ws = new FakeSocket();
		state.tag(ws, ['alice']);
		await hub.webSocketMessage(ws as never, JSON.stringify({ type: 'unwatch', peer: 'bob' }));
		expect(paths()).toEqual(['/unwatch']);
	});

	it('the watch route is reachable and records the watcher', async () => {
		await hub.fetch(req('/watch', { method: 'POST', body: JSON.stringify({ uid: 'alice' }) }));
		expect(state._store.get('watchers')).toEqual(['alice']);
	});

	it('the watch route is idempotent', async () => {
		await hub.fetch(req('/watch', { method: 'POST', body: JSON.stringify({ uid: 'alice' }) }));
		await hub.fetch(req('/watch', { method: 'POST', body: JSON.stringify({ uid: 'alice' }) }));
		expect(state._store.get('watchers')).toEqual(['alice']);
	});

	it('the watcher list never grows past MAX_WATCHERS', async () => {
		for (let i = 0; i < MAX_WATCHERS + 25; i++) {
			await hub.fetch(req('/watch', { method: 'POST', body: JSON.stringify({ uid: 'w' + i }) }));
		}
		expect((state._store.get('watchers') as string[]).length).toBe(MAX_WATCHERS);
	});

	it('notifies every watcher concurrently, not one after another', async () => {
		state._store.set('watchers', ['a', 'b', 'c', 'd']);
		let started = 0;
		let release!: () => void;
		const gate = new Promise<void>((r) => (release = r));
		stubFetch.mockImplementation(async () => {
			started++;
			await gate;
			return new Response('ok');
		});

		const ws = new FakeSocket();
		state.tag(ws, ['alice']);
		const done = hub.webSocketClose(ws as never);
		await Promise.resolve();
		await Promise.resolve();

		expect(started).toBe(4);
		release();
		await done;
	});

	it('one unreachable watcher does not stop the others', async () => {
		state._store.set('watchers', ['a', 'b', 'c']);
		stubFetch.mockImplementation(async () => {
			if (stubFetch.mock.calls.length === 2) throw new Error('down');
			return new Response('ok');
		});
		const ws = new FakeSocket();
		state.tag(ws, ['alice']);
		await expect(hub.webSocketClose(ws as never)).resolves.toBeUndefined();
		expect(stubFetch).toHaveBeenCalledTimes(3);
	});
});
