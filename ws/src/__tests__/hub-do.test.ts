import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChatHub } from '../hub';

class FakeSocket {
	sent: string[] = [];
	closed = false;
	send(data: string) {
		this.sent.push(data);
	}
	close() {
		this.closed = true;
	}
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
		_socketsByTag: socketsByTag
	};
}

function req(url: string, init?: RequestInit) {
	return new Request(url, init);
}

const SECRET = 'shared-secret';

describe('ChatHub.fetch', () => {
	let state: ReturnType<typeof makeState>;
	let stubFetch: ReturnType<typeof vi.fn>;
	let env: { CHAT_HUB: { idFromName: (n: string) => string; get: (id: string) => { fetch: typeof stubFetch } }; SECRET: string };

	beforeEach(() => {
		state = makeState();
		stubFetch = vi.fn().mockResolvedValue(new Response('ok'));
		env = {
			SECRET,
			CHAT_HUB: {
				idFromName: (n: string) => n,
				get: () => ({ fetch: stubFetch })
			}
		};
	});

	it('returns 400 for an unrecognized path', async () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const hub = new ChatHub(state as any, env as any);
		const res = await hub.fetch(req('https://dummy/nope'));
		expect(res.status).toBe(400);
	});

	it('denies a websocket upgrade with a bad token', async () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const hub = new ChatHub(state as any, env as any);
		const res = await hub.fetch(
			req('https://dummy/ws?uid=uid-1&t=garbage', { headers: { upgrade: 'websocket' } })
		);
		expect(res.status).toBe(403);
		expect(state.acceptWebSocket).not.toHaveBeenCalled();
	});

	it('unwraps a secrets-store-style SECRET binding (not a plain string) before verifying', async () => {
		// production SECRET is bound via secrets_store_secrets, i.e. an object with .get(), not a
		// raw string — this guards against passing that object straight into verify_token, which
		// previously stringified to "[object Object]" and made every token check fail.
		vi.stubGlobal(
			'WebSocketPair',
			class {
				0 = new FakeSocket();
				1 = new FakeSocket();
			}
		);
		const bound_env = { ...env, SECRET: { get: async () => SECRET } };
		const raw = new TextEncoder().encode(`uid-1.${SECRET}`);
		const sig = await crypto.subtle.digest('SHA-256', raw);
		const t = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const hub = new ChatHub(state as any, bound_env as any);
		// the 101-upgrade Response construction itself is workerd-only (see note above) and throws
		// under Node — what we're actually verifying is that we got PAST the auth check, i.e.
		// get_secret correctly unwrapped the bound SECRET before verify_token compared it.
		await hub.fetch(req(`https://dummy/ws?uid=uid-1&t=${t}`, { headers: { upgrade: 'websocket' } })).catch(() => {});
		expect(state.acceptWebSocket).toHaveBeenCalledWith(expect.anything(), ['uid-1']);
		vi.unstubAllGlobals();
	});

	// Note: the successful 101-upgrade path constructs a `new Response(null, { status: 101,
	// webSocket })`, a Cloudflare-Workers-only Response extension that Node's fetch impl rejects
	// (RangeError: status must be 200-599). That leg can only run under real workerd (e.g.
	// `pnpm dev:ws` / `wrangler dev`), so it's exercised there rather than under vitest's node env.
	// The auth-denial branch above covers verify_token wiring, which is the part most likely to break.

	it('relays a chat message to sockets tagged with the recipient uid', async () => {
		const recipient = new FakeSocket();
		state.acceptWebSocket(recipient, ['bob']);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const hub = new ChatHub(state as any, env as any);
		const res = await hub.fetch(
			req('https://dummy/relay', {
				method: 'POST',
				body: JSON.stringify({ to: 'bob', from: 'alice', from_name: 'Alice', text: 'hi', ts: 123 })
			})
		);
		expect(res.status).toBe(200);
		expect(recipient.sent).toEqual([
			JSON.stringify({ type: 'msg', from: 'alice', from_name: 'Alice', text: 'hi', ts: 123 })
		]);
	});

	it('does not relay when the request is not a POST', async () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const hub = new ChatHub(state as any, env as any);
		const res = await hub.fetch(req('https://dummy/relay', { method: 'GET' }));
		expect(res.status).toBe(400);
	});

	it('forwards raw signal payloads (offer/answer/ice) to the target uid', async () => {
		const recipient = new FakeSocket();
		state.acceptWebSocket(recipient, ['bob']);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const hub = new ChatHub(state as any, env as any);
		const payload = { type: 'signal', to: 'bob', from: 'alice', signal: { type: 'offer', sdp: {} } };
		const res = await hub.fetch(req('https://dummy/signal', { method: 'POST', body: JSON.stringify(payload) }));
		expect(res.status).toBe(200);
		expect(recipient.sent).toEqual([JSON.stringify(payload)]);
	});
});

describe('ChatHub.webSocketMessage', () => {
	it('ignores non-signal messages', async () => {
		const state = makeState();
		const stubFetch = vi.fn();
		const env = { SECRET, CHAT_HUB: { idFromName: (n: string) => n, get: () => ({ fetch: stubFetch }) } };
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const hub = new ChatHub(state as any, env as any);
		const ws = new FakeSocket();
		await hub.webSocketMessage(ws as unknown as WebSocket, JSON.stringify({ type: 'chat', to: 'bob' }));
		expect(stubFetch).not.toHaveBeenCalled();
	});

	it('routes a signal message to the target uid DO, stamping the sender from the socket tag', async () => {
		const state = makeState();
		const ws = new FakeSocket();
		state.acceptWebSocket(ws, ['alice']);
		const stubFetch = vi.fn().mockResolvedValue(new Response('ok'));
		const idFromName = vi.fn((n: string) => `id:${n}`);
		const get = vi.fn(() => ({ fetch: stubFetch }));
		const env = { SECRET, CHAT_HUB: { idFromName, get } };
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const hub = new ChatHub(state as any, env as any);
		await hub.webSocketMessage(
			ws as unknown as WebSocket,
			JSON.stringify({ type: 'signal', to: 'bob', signal: { type: 'ice' } })
		);
		expect(idFromName).toHaveBeenCalledWith('bob');
		expect(stubFetch).toHaveBeenCalledTimes(1);
		const sentBody = JSON.parse(stubFetch.mock.calls[0][1].body);
		expect(sentBody).toMatchObject({ type: 'signal', to: 'bob', from: 'alice' });
	});
});

describe('ChatHub.webSocketClose', () => {
	it('announces the closing uid as offline to all connected sockets and closes it', async () => {
		const state = makeState();
		const closing = new FakeSocket();
		const other = new FakeSocket();
		state.acceptWebSocket(closing, ['alice']);
		state.acceptWebSocket(other, ['bob']);
		const env = { SECRET, CHAT_HUB: { idFromName: (n: string) => n, get: () => ({ fetch: vi.fn() }) } };
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const hub = new ChatHub(state as any, env as any);
		await hub.webSocketClose(closing as unknown as WebSocket);
		expect(closing.closed).toBe(true);
		const presenceMsg = JSON.stringify({ type: 'presence', uid: 'alice', online: false });
		expect(other.sent).toContain(presenceMsg);
	});
});
