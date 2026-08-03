import { describe, it, expect, vi, beforeEach } from 'vitest';

const { sendPushMock } = vi.hoisted(() => ({ sendPushMock: vi.fn() }));
vi.mock('../../../src/lib/server/push', async () => {
	const actual =
		await vi.importActual<typeof import('../../../src/lib/server/push')>('../../../src/lib/server/push');
	return { ...actual, send_push: sendPushMock };
});

import { ChatHub } from '../hub';

// real workerd provides this globally; vitest's node env does not — every ChatHub
// constructor call needs it now that it calls setWebSocketAutoResponse unconditionally.
class FakeReqRespPair {
	constructor(
		public request: string,
		public response: string
	) {}
}
// re-stubbed before every test (not just once at import) because one existing test below
// calls vi.unstubAllGlobals(), which would otherwise wipe this out for every test after it.
beforeEach(() => {
	vi.stubGlobal('WebSocketRequestResponsePair', FakeReqRespPair);
});

class FakeSocket {
	sent: string[] = [];
	closed = false;
	_attachment: { active?: boolean } | null = null;
	send(data: string) {
		this.sent.push(data);
	}
	close() {
		this.closed = true;
	}
	serializeAttachment(att: { active?: boolean }) {
		this._attachment = att;
	}
	deserializeAttachment(): { active?: boolean } | null {
		return this._attachment;
	}
}

function makeState() {
	const socketsByTag = new Map<string, FakeSocket[]>();
	const allSockets: FakeSocket[] = [];
	const tagsBySocket = new Map<FakeSocket, string[]>();
	const store = new Map<string, unknown>();
	return {
		acceptWebSocket: vi.fn((ws: FakeSocket, tags: string[]) => {
			allSockets.push(ws);
			tagsBySocket.set(ws, tags);
			for (const t of tags) socketsByTag.set(t, [...(socketsByTag.get(t) ?? []), ws]);
		}),
		// real Workers hibernatable-websocket getWebSockets() excludes sockets that have
		// already closed — mirror that here rather than requiring every test to fake it
		getWebSockets: vi.fn((tag?: string) =>
			(tag ? (socketsByTag.get(tag) ?? []) : allSockets).filter((s) => !s.closed)
		),
		getTags: vi.fn((ws: FakeSocket) => tagsBySocket.get(ws) ?? []),
		setWebSocketAutoResponse: vi.fn(),
		storage: {
			get: vi.fn(async (k: string) => store.get(k)),
			put: vi.fn(async (k: string, v: unknown) => {
				store.set(k, v);
			}),
			delete: vi.fn(async (k: string | string[]) => {
				for (const key of Array.isArray(k) ? k : [k]) store.delete(key);
			}),
			list: vi.fn(async (opts?: { prefix?: string }) => {
				const m = new Map<string, unknown>();
				for (const [k, v] of store) if (!opts?.prefix || k.startsWith(opts.prefix)) m.set(k, v);
				return m;
			})
		},
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
	let env: {
		CHAT_HUB: {
			idFromName: (n: string) => string;
			get: (id: string) => { fetch: typeof stubFetch };
		};
		SECRET: string;
		VAPID_PUBLIC?: string;
		VAPID_PRIVATE?: string;
		VAPID_SUBJECT?: string;
	};

	beforeEach(() => {
		state = makeState();
		stubFetch = vi.fn().mockResolvedValue(new Response('ok'));
		env = {
			SECRET,
			VAPID_PUBLIC: 'vapid-pub',
			VAPID_PRIVATE: 'vapid-priv',
			VAPID_SUBJECT: 'mailto:a@b',
			CHAT_HUB: {
				idFromName: (n: string) => n,
				get: () => ({ fetch: stubFetch })
			}
		};
		sendPushMock.mockReset().mockResolvedValue({ ok: true, status: 201, gone: false });
	});

	it('registers a ping/pong auto-response so pings never wake the DO', () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		new ChatHub(state as any, env as any);
		expect(state.setWebSocketAutoResponse).toHaveBeenCalledTimes(1);
		const pair = state.setWebSocketAutoResponse.mock.calls[0][0] as FakeReqRespPair;
		expect(pair.request).toBe('{"type":"ping"}');
		expect(pair.response).toBe('{"type":"pong"}');
	});

	it('no longer sends a manual pong — the auto-response handles it before webSocketMessage runs', async () => {
		const ws = new FakeSocket();
		state.acceptWebSocket(ws, ['bob']);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const hub = new ChatHub(state as any, env as any);
		await hub.webSocketMessage(ws as unknown as WebSocket, JSON.stringify({ type: 'ping' }));
		expect(ws.sent).toEqual([]);
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
		const k = await crypto.subtle.importKey(
			'raw', new TextEncoder().encode(SECRET).slice(0, 32),
			{ name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
		);
		const exp = Date.now() + 60_000;
		const sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(`uid-1.${exp}`));
		const t = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
		const proto = `x2.uid-1.${exp}.${t}`;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const hub = new ChatHub(state as any, bound_env as any);
		// the 101-upgrade Response construction itself is workerd-only (see note above) and throws
		// under Node — what we're actually verifying is that we got PAST the auth check, i.e.
		// get_secret correctly unwrapped the bound SECRET before verify_token compared it.
		await hub
			.fetch(req('https://dummy/ws', { headers: { upgrade: 'websocket', 'sec-websocket-protocol': proto } }))
			.catch(() => {});
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

	it('forwards reply_msg through the relay to the recipient socket', async () => {
		const recipient = new FakeSocket();
		state.acceptWebSocket(recipient, ['bob']);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const hub = new ChatHub(state as any, env as any);
		await hub.fetch(
			req('https://dummy/relay', {
				method: 'POST',
				body: JSON.stringify({
					to: 'bob', from: 'alice', from_name: 'Alice', text: 'got it', reply_msg: 'orig-1', ts: 123
				})
			})
		);
		expect(recipient.sent).toEqual([
			JSON.stringify({ type: 'msg', from: 'alice', from_name: 'Alice', text: 'got it', reply_msg: 'orig-1', ts: 123 })
		]);
	});

	it('forwards a sticker id through the relay to the recipient socket', async () => {
		const recipient = new FakeSocket();
		state.acceptWebSocket(recipient, ['bob']);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const hub = new ChatHub(state as any, env as any);
		await hub.fetch(
			req('https://dummy/relay', {
				method: 'POST',
				body: JSON.stringify({
					to: 'bob', from: 'alice', from_name: 'Alice', text: '', sticker: 'wave', ts: 123
				})
			})
		);
		expect(recipient.sent).toEqual([
			JSON.stringify({ type: 'msg', from: 'alice', from_name: 'Alice', text: '', sticker: 'wave', ts: 123 })
		]);
	});

	it('relays a reaction update to the recipient socket', async () => {
		const recipient = new FakeSocket();
		state.acceptWebSocket(recipient, ['bob']);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const hub = new ChatHub(state as any, env as any);
		await hub.fetch(
			req('https://dummy/relay', {
				method: 'POST',
				body: JSON.stringify({
					to: 'bob', type: 'reaction', id: 'm1', rx: { '👍': ['alice'] }, ts: 123
				})
			})
		);
		expect(recipient.sent).toEqual([
			JSON.stringify({ type: 'reaction', id: 'm1', rx: { '👍': ['alice'] } })
		]);
	});

	it('relays an edit update to the recipient socket', async () => {
		const recipient = new FakeSocket();
		state.acceptWebSocket(recipient, ['bob']);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const hub = new ChatHub(state as any, env as any);
		await hub.fetch(
			req('https://dummy/relay', {
				method: 'POST',
				body: JSON.stringify({
					to: 'bob', type: 'edit', id: 'm1', from: 'alice', text: 'edited', e: 456, ts: 123
				})
			})
		);
		expect(recipient.sent).toEqual([
			JSON.stringify({ type: 'edit', id: 'm1', from: 'alice', text: 'edited', e: 456, ts: 123 })
		]);
	});

	it('relays a delete to the recipient socket', async () => {
		const recipient = new FakeSocket();
		state.acceptWebSocket(recipient, ['bob']);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const hub = new ChatHub(state as any, env as any);
		await hub.fetch(
			req('https://dummy/relay', {
				method: 'POST',
				body: JSON.stringify({ to: 'bob', type: 'delete', id: 'm1', ts: 123 })
			})
		);
		expect(recipient.sent).toEqual([JSON.stringify({ type: 'delete', id: 'm1' })]);
	});

	it('reports the relay as delivered when a socket was there to take it', async () => {
		state.acceptWebSocket(new FakeSocket(), ['bob']);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const hub = new ChatHub(state as any, env as any);
		const res = await hub.fetch(
			req('https://dummy/relay', {
				method: 'POST',
				body: JSON.stringify({ to: 'bob', from: 'alice', text: 'hi', ts: 123 })
			})
		);
		expect(await res.json()).toEqual({ delivered: true });
	});

	it('reports the relay as undelivered when nobody was connected — this is what triggers a push', async () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const hub = new ChatHub(state as any, env as any);
		const res = await hub.fetch(
			req('https://dummy/relay', {
				method: 'POST',
				body: JSON.stringify({ to: 'bob', from: 'alice', text: 'hi', ts: 123 })
			})
		);
		expect(await res.json()).toEqual({ delivered: false });
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
		const payload = {
			type: 'signal',
			to: 'bob',
			from: 'alice',
			signal: { type: 'offer', sdp: {} }
		};
		const res = await hub.fetch(
			req('https://dummy/signal', { method: 'POST', body: JSON.stringify(payload) })
		);
		expect(res.status).toBe(200);
		expect(recipient.sent).toEqual([JSON.stringify(payload)]);
	});

	it('records a socket as inactive when it reports type:active on:false', async () => {
		const ws = new FakeSocket();
		state.acceptWebSocket(ws, ['bob']);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const hub = new ChatHub(state as any, env as any);
		await hub.webSocketMessage(
			ws as unknown as WebSocket,
			JSON.stringify({ type: 'active', on: false })
		);
		expect(ws._attachment).toEqual({ active: false });
	});

	it('reports delivered:false when every socket for the uid is backgrounded', async () => {
		const bg = new FakeSocket();
		bg.serializeAttachment({ active: false });
		state.acceptWebSocket(bg, ['bob']);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const hub = new ChatHub(state as any, env as any);
		const res = await hub.fetch(
			req('https://dummy/relay', {
				method: 'POST',
				body: JSON.stringify({ to: 'bob', from: 'alice', text: 'hi', ts: 1 })
			})
		);
		expect(await res.json()).toEqual({ delivered: false });
	});

	it('reports delivered:true when at least one socket is foregrounded', async () => {
		const fg = new FakeSocket();
		fg.serializeAttachment({ active: true });
		const bg = new FakeSocket();
		bg.serializeAttachment({ active: false });
		state.acceptWebSocket(fg, ['bob']);
		state.acceptWebSocket(bg, ['bob']);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const hub = new ChatHub(state as any, env as any);
		const res = await hub.fetch(
			req('https://dummy/relay', {
				method: 'POST',
				body: JSON.stringify({ to: 'bob', from: 'alice', text: 'hi', ts: 1 })
			})
		);
		expect(await res.json()).toEqual({ delivered: true });
	});

	it('still sends the frame to backgrounded sockets', async () => {
		const bg = new FakeSocket();
		bg.serializeAttachment({ active: false });
		state.acceptWebSocket(bg, ['bob']);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const hub = new ChatHub(state as any, env as any);
		await hub.fetch(
			req('https://dummy/relay', {
				method: 'POST',
				body: JSON.stringify({ to: 'bob', from: 'alice', text: 'hi', ts: 1 })
			})
		);
		expect(bg.sent.length).toBe(1);
	});

	it('treats a socket that never reported its state as active', async () => {
		const legacy = new FakeSocket();
		state.acceptWebSocket(legacy, ['bob']);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const hub = new ChatHub(state as any, env as any);
		const res = await hub.fetch(
			req('https://dummy/relay', {
				method: 'POST',
				body: JSON.stringify({ to: 'bob', from: 'alice', text: 'hi', ts: 1 })
			})
		);
		expect(await res.json()).toEqual({ delivered: true });
	});

	it('survives a socket whose attachment is null', async () => {
		const ws = new FakeSocket();
		ws._attachment = null;
		state.acceptWebSocket(ws, ['bob']);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const hub = new ChatHub(state as any, env as any);
		const res = await hub.fetch(
			req('https://dummy/relay', {
				method: 'POST',
				body: JSON.stringify({ to: 'bob', from: 'alice', text: 'hi', ts: 1 })
			})
		);
		expect(await res.json()).toEqual({ delivered: true });
	});

	it('reports online:false from /check when every socket is backgrounded', async () => {
		const bg = new FakeSocket();
		bg.serializeAttachment({ active: false });
		state.acceptWebSocket(bg, ['bob']);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const hub = new ChatHub(state as any, env as any);
		const res = await hub.fetch(req('https://dummy/check'));
		expect(await res.json()).toEqual({ online: false });
	});

	it('reports online:true from /check when one socket is foregrounded', async () => {
		const fg = new FakeSocket();
		fg.serializeAttachment({ active: true });
		state.acceptWebSocket(fg, ['bob']);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const hub = new ChatHub(state as any, env as any);
		const res = await hub.fetch(req('https://dummy/check'));
		expect(await res.json()).toEqual({ online: true });
	});
});

describe('ChatHub.webSocketMessage', () => {
	it('ignores non-signal messages', async () => {
		const state = makeState();
		const stubFetch = vi.fn();
		const env = {
			SECRET,
			CHAT_HUB: { idFromName: (n: string) => n, get: () => ({ fetch: stubFetch }) }
		};
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const hub = new ChatHub(state as any, env as any);
		const ws = new FakeSocket();
		await hub.webSocketMessage(
			ws as unknown as WebSocket,
			JSON.stringify({ type: 'chat', to: 'bob' })
		);
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
		const env = {
			SECRET,
			CHAT_HUB: { idFromName: (n: string) => n, get: () => ({ fetch: vi.fn() }) }
		};
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const hub = new ChatHub(state as any, env as any);
		await hub.webSocketClose(closing as unknown as WebSocket);
		expect(closing.closed).toBe(true);
		const presenceMsg = JSON.stringify({ type: 'presence', uid: 'alice', online: false });
		expect(other.sent).toContain(presenceMsg);
	});

	it('does not announce offline while a second socket for the same uid is still open — multi-tab', async () => {
		const state = makeState();
		const closingTab = new FakeSocket();
		const stillOpenTab = new FakeSocket();
		const watcher = new FakeSocket();
		state.acceptWebSocket(closingTab, ['alice']);
		state.acceptWebSocket(stillOpenTab, ['alice']);
		state.acceptWebSocket(watcher, ['bob']);
		const stubFetch = vi.fn().mockResolvedValue(new Response('ok'));
		const env = {
			SECRET,
			CHAT_HUB: { idFromName: (n: string) => n, get: () => ({ fetch: stubFetch }) }
		};
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const hub = new ChatHub(state as any, env as any);
		await hub.webSocketClose(closingTab as unknown as WebSocket);
		expect(closingTab.closed).toBe(true);
		const presenceOffline = JSON.stringify({ type: 'presence', uid: 'alice', online: false });
		expect(watcher.sent).not.toContain(presenceOffline);
		expect(stillOpenTab.sent).not.toContain(presenceOffline);
	});

	it('announces offline once the last socket for a uid closes', async () => {
		const state = makeState();
		const closing = new FakeSocket();
		const watcher = new FakeSocket();
		state.acceptWebSocket(closing, ['alice']);
		state.acceptWebSocket(watcher, ['bob']);
		const env = {
			SECRET,
			CHAT_HUB: { idFromName: (n: string) => n, get: () => ({ fetch: vi.fn() }) }
		};
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const hub = new ChatHub(state as any, env as any);
		await hub.webSocketClose(closing as unknown as WebSocket);
		const presenceOffline = JSON.stringify({ type: 'presence', uid: 'alice', online: false });
		expect(watcher.sent).toContain(presenceOffline);
	});
});

// hub_owns_delivery: ChatHub now owns unread counts, read markers, mutes and push
// subscriptions for its own uid, and pushes for itself on /relay instead of the caller
// computing all of this via Qdrant scrolls and a separate notify() fan-out.
describe('ChatHub — unread, mute and push (hub_owns_delivery)', () => {
	let state: ReturnType<typeof makeState>;
	let env: {
		CHAT_HUB: { idFromName: (n: string) => string; get: (id: string) => { fetch: ReturnType<typeof vi.fn> } };
		SECRET: string;
		VAPID_PUBLIC?: string;
		VAPID_PRIVATE?: string;
		VAPID_SUBJECT?: string;
	};

	beforeEach(() => {
		state = makeState();
		env = {
			SECRET,
			VAPID_PUBLIC: 'vapid-pub',
			VAPID_PRIVATE: 'vapid-priv',
			VAPID_SUBJECT: 'mailto:a@b',
			CHAT_HUB: { idFromName: (n: string) => n, get: () => ({ fetch: vi.fn() }) }
		};
		sendPushMock.mockReset().mockResolvedValue({ ok: true, status: 201, gone: false });
	});

	function hub() {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		return new ChatHub(state as any, env as any);
	}

	const relay = (h: ChatHub, body: Record<string, unknown>) =>
		h.fetch(req('https://dummy/relay', { method: 'POST', body: JSON.stringify(body) }));

	it('bumps unread:<conv> when a message is relayed', async () => {
		const h = hub();
		await relay(h, { to: 'me', from: 'bob', text: 'hi', ts: 1, conv: 'bob|me' });
		const res = await h.fetch(req('https://dummy/unread'));
		expect(await res.json()).toEqual({ total: 1, by_conv: { 'bob|me': 1 } });
	});

	it('accumulates unread across repeated messages in the same conversation', async () => {
		const h = hub();
		await relay(h, { to: 'me', from: 'bob', text: 'hi', ts: 1, conv: 'bob|me' });
		await relay(h, { to: 'me', from: 'bob', text: 'again', ts: 2, conv: 'bob|me' });
		const res = await h.fetch(req('https://dummy/unread'));
		expect(await res.json()).toEqual({ total: 2, by_conv: { 'bob|me': 2 } });
	});

	it('POST /read clears the counter for that conversation and returns the new total', async () => {
		const h = hub();
		await relay(h, { to: 'me', from: 'bob', text: 'hi', ts: 1, conv: 'bob|me' });
		await relay(h, { to: 'me', from: 'carol', text: 'hey', ts: 1, conv: 'carol|me' });
		const res = await h.fetch(
			req('https://dummy/read', { method: 'POST', body: JSON.stringify({ conv: 'bob|me', ts: 1 }) })
		);
		expect(await res.json()).toEqual({ total: 1 });
		const after = await h.fetch(req('https://dummy/unread'));
		expect(await after.json()).toEqual({ total: 1, by_conv: { 'carol|me': 1 } });
	});

	it('excludes a muted conversation from both by_conv and the total', async () => {
		const h = hub();
		await h.fetch(
			req('https://dummy/mute', {
				method: 'POST',
				body: JSON.stringify({ target: 'bob', kind: 'u', until: 0 })
			})
		);
		await relay(h, { to: 'me', from: 'bob', text: 'hi', ts: 1, conv: 'bob|me', mute_key: 'bob' });
		const res = await h.fetch(req('https://dummy/unread'));
		expect(await res.json()).toEqual({ total: 0, by_conv: {} });
	});

	it('an undelivered message pushes to every stored subscription', async () => {
		const h = hub();
		await h.fetch(
			req('https://dummy/sub', {
				method: 'POST',
				body: JSON.stringify({ ep: 'https://push/a', k: 'PUB1', au: 'AUTH1' })
			})
		);
		await h.fetch(
			req('https://dummy/sub', {
				method: 'POST',
				body: JSON.stringify({ ep: 'https://push/b', k: 'PUB2', au: 'AUTH2' })
			})
		);
		await relay(h, {
			to: 'me',
			from: 'bob',
			text: 'hi',
			ts: 1,
			conv: 'bob|me',
			mute_key: 'bob',
			title: 'bob',
			push_body: 'hi',
			url: '/app/chat/bob'
		});
		expect(sendPushMock).toHaveBeenCalledTimes(2);
	});

	it('a muted target is not pushed, even though nobody is connected', async () => {
		const h = hub();
		await h.fetch(
			req('https://dummy/sub', {
				method: 'POST',
				body: JSON.stringify({ ep: 'https://push/a', k: 'PUB1', au: 'AUTH1' })
			})
		);
		await h.fetch(
			req('https://dummy/mute', {
				method: 'POST',
				body: JSON.stringify({ target: 'bob', kind: 'u', until: 0 })
			})
		);
		await relay(h, {
			to: 'me',
			from: 'bob',
			text: 'hi',
			ts: 1,
			conv: 'bob|me',
			mute_key: 'bob',
			title: 'bob',
			push_body: 'hi'
		});
		expect(sendPushMock).not.toHaveBeenCalled();
	});

	it('does not push when a socket already delivered the message', async () => {
		const recipient = new FakeSocket();
		state.acceptWebSocket(recipient, ['me']);
		const h = hub();
		await h.fetch(
			req('https://dummy/sub', {
				method: 'POST',
				body: JSON.stringify({ ep: 'https://push/a', k: 'PUB1', au: 'AUTH1' })
			})
		);
		await relay(h, { to: 'me', from: 'bob', text: 'hi', ts: 1, conv: 'bob|me', mute_key: 'bob' });
		expect(sendPushMock).not.toHaveBeenCalled();
	});

	it('prunes a subscription the push service reports gone', async () => {
		sendPushMock.mockResolvedValueOnce({ ok: false, status: 410, gone: true });
		const h = hub();
		await h.fetch(
			req('https://dummy/sub', {
				method: 'POST',
				body: JSON.stringify({ ep: 'https://push/a', k: 'PUB1', au: 'AUTH1' })
			})
		);
		await relay(h, { to: 'me', from: 'bob', text: 'hi', ts: 1, conv: 'bob|me', mute_key: 'bob' });
		expect(sendPushMock).toHaveBeenCalledTimes(1);
		sendPushMock.mockClear();
		await relay(h, { to: 'me', from: 'bob', text: 'hi again', ts: 2, conv: 'bob|me', mute_key: 'bob' });
		expect(sendPushMock).not.toHaveBeenCalled();
	});

	it('never pushes when VAPID is not configured', async () => {
		env.VAPID_PUBLIC = undefined;
		const h = hub();
		await h.fetch(
			req('https://dummy/sub', {
				method: 'POST',
				body: JSON.stringify({ ep: 'https://push/a', k: 'PUB1', au: 'AUTH1' })
			})
		);
		await relay(h, { to: 'me', from: 'bob', text: 'hi', ts: 1, conv: 'bob|me', mute_key: 'bob' });
		expect(sendPushMock).not.toHaveBeenCalled();
	});

	it('a corrupt subscription does not block the others and is pruned', async () => {
		sendPushMock.mockRejectedValueOnce(new Error('boom'));
		const h = hub();
		await h.fetch(
			req('https://dummy/sub', {
				method: 'POST',
				body: JSON.stringify({ ep: 'https://push/a', k: 'PUB1', au: 'AUTH1' })
			})
		);
		await h.fetch(
			req('https://dummy/sub', {
				method: 'POST',
				body: JSON.stringify({ ep: 'https://push/b', k: 'PUB2', au: 'AUTH2' })
			})
		);
		const res = await relay(h, {
			to: 'me',
			from: 'bob',
			text: 'hi',
			ts: 1,
			conv: 'bob|me',
			mute_key: 'bob'
		});
		expect(await res.json()).toEqual({ delivered: false });
		expect(sendPushMock).toHaveBeenCalledTimes(2);
		sendPushMock.mockClear();
		await relay(h, { to: 'me', from: 'bob', text: 'hi again', ts: 2, conv: 'bob|me', mute_key: 'bob' });
		expect(sendPushMock).toHaveBeenCalledTimes(1);
	});

	it('relay still responds when every push fails', async () => {
		sendPushMock.mockRejectedValue(new Error('boom'));
		const h = hub();
		await h.fetch(
			req('https://dummy/sub', {
				method: 'POST',
				body: JSON.stringify({ ep: 'https://push/a', k: 'PUB1', au: 'AUTH1' })
			})
		);
		const res = await relay(h, { to: 'me', from: 'bob', text: 'hi', ts: 1, conv: 'bob|me', mute_key: 'bob' });
		expect(await res.json()).toEqual({ delivered: false });
		expect(state.storage.delete).toHaveBeenCalled();
	});

	it('POST /mute then GET /mutes lists it as active', async () => {
		const h = hub();
		await h.fetch(
			req('https://dummy/mute', {
				method: 'POST',
				body: JSON.stringify({ target: 'bob', kind: 'u', until: 0 })
			})
		);
		const res = await h.fetch(req('https://dummy/mutes'));
		expect(await res.json()).toEqual({ mutes: [{ tg: 'bob', k: 'u', until: 0 }] });
	});

	it('excludes an expired mute from GET /mutes', async () => {
		const h = hub();
		await h.fetch(
			req('https://dummy/mute', {
				method: 'POST',
				body: JSON.stringify({ target: 'bob', kind: 'u', until: Date.now() - 1000 })
			})
		);
		const res = await h.fetch(req('https://dummy/mutes'));
		expect(await res.json()).toEqual({ mutes: [] });
	});

	it('POST /unmute removes it from GET /mutes', async () => {
		const h = hub();
		await h.fetch(
			req('https://dummy/mute', {
				method: 'POST',
				body: JSON.stringify({ target: 'bob', kind: 'u', until: 0 })
			})
		);
		await h.fetch(
			req('https://dummy/unmute', { method: 'POST', body: JSON.stringify({ target: 'bob' }) })
		);
		const res = await h.fetch(req('https://dummy/mutes'));
		expect(await res.json()).toEqual({ mutes: [] });
	});

	it('POST /sub then POST /unsub removes it — verified via no further push', async () => {
		const h = hub();
		await h.fetch(
			req('https://dummy/sub', {
				method: 'POST',
				body: JSON.stringify({ ep: 'https://push/a', k: 'PUB1', au: 'AUTH1' })
			})
		);
		await h.fetch(
			req('https://dummy/unsub', { method: 'POST', body: JSON.stringify({ ep: 'https://push/a' }) })
		);
		await relay(h, { to: 'me', from: 'bob', text: 'hi', ts: 1, conv: 'bob|me', mute_key: 'bob' });
		expect(sendPushMock).not.toHaveBeenCalled();
	});
});

// hub_conv_index: ChatHub indexes conversations from relayed messages, and GET /convs
// returns the full list in recency order merged with unread counts.
describe('ChatHub — conversation index (hub_conv_index)', () => {
	let state: ReturnType<typeof makeState>;
	let env: {
		CHAT_HUB: { idFromName: (n: string) => string; get: (id: string) => { fetch: ReturnType<typeof vi.fn> } };
		SECRET: string;
		VAPID_PUBLIC?: string;
		VAPID_PRIVATE?: string;
		VAPID_SUBJECT?: string;
	};

	beforeEach(() => {
		state = makeState();
		env = {
			SECRET,
			VAPID_PUBLIC: 'vapid-pub',
			VAPID_PRIVATE: 'vapid-priv',
			VAPID_SUBJECT: 'mailto:a@b',
			CHAT_HUB: { idFromName: (n: string) => n, get: () => ({ fetch: vi.fn() }) }
		};
	});

	function hub() {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		return new ChatHub(state as any, env as any);
	}

	const relay = (h: ChatHub, body: Record<string, unknown>) =>
		h.fetch(req('https://dummy/relay', { method: 'POST', body: JSON.stringify(body) }));

	it('writes conv:<conv_id> with peer and preview from a relayed 1:1 msg', async () => {
		const h = hub();
		await relay(h, { to: 'me', from: 'bob', text: 'hey', ts: 1000, conv: 'bob|me' });
		const res = await h.fetch(req('https://dummy/convs'));
		const body = await res.json();
		expect(body.convs).toEqual([{ peer: 'bob', last: 1000, preview: 'hey', unread: 1 }]);
	});

	it('writes conv:<conv_id> with group and preview from a relayed group msg', async () => {
		const h = hub();
		await relay(h, {
			to: 'me', from: 'alice', group: 'g1', text: 'hello room', ts: 2000, conv: 'g:g1'
		});
		const res = await h.fetch(req('https://dummy/convs'));
		const body = await res.json();
		expect(body.convs).toEqual([{ group: 'g1', last: 2000, preview: 'hello room', unread: 1 }]);
	});

	it('a second message to the same conv overwrites last and preview', async () => {
		const h = hub();
		await relay(h, { to: 'me', from: 'bob', text: 'first', ts: 100, conv: 'bob|me' });
		await relay(h, { to: 'me', from: 'bob', text: 'second', ts: 200, conv: 'bob|me' });
		const res = await h.fetch(req('https://dummy/convs'));
		const body = await res.json();
		expect(body.convs).toEqual([{ peer: 'bob', last: 200, preview: 'second', unread: 2 }]);
	});

	it('returns convs sorted by last descending', async () => {
		const h = hub();
		await relay(h, { to: 'me', from: 'carol', text: 'old', ts: 50, conv: 'carol|me' });
		await relay(h, { to: 'me', from: 'bob', text: 'recent', ts: 200, conv: 'bob|me' });
		const res = await h.fetch(req('https://dummy/convs'));
		const body = await res.json();
		expect(body.convs.map((c: { peer: string }) => c.peer)).toEqual(['bob', 'carol']);
	});

	it('merges unread counts into each conv entry', async () => {
		const h = hub();
		await relay(h, { to: 'me', from: 'bob', text: 'hey', ts: 100, conv: 'bob|me' });
		await relay(h, { to: 'me', from: 'bob', text: 'again', ts: 200, conv: 'bob|me' });
		const res = await h.fetch(req('https://dummy/convs'));
		const body = await res.json();
		expect(body.convs[0].unread).toBe(2);
	});

	it('excludes muted conversations from convs', async () => {
		const h = hub();
		await h.fetch(
			req('https://dummy/mute', { method: 'POST', body: JSON.stringify({ target: 'bob', kind: 'u', until: 0 }) })
		);
		await relay(h, { to: 'me', from: 'bob', text: 'hey', ts: 100, conv: 'bob|me', mute_key: 'bob' });
		await relay(h, { to: 'me', from: 'carol', text: 'hi', ts: 200, conv: 'carol|me' });
		const res = await h.fetch(req('https://dummy/convs'));
		const body = await res.json();
		expect(body.convs).toEqual([{ peer: 'carol', last: 200, preview: 'hi', unread: 1 }]);
	});

	it('picks file or image preview when text is empty', async () => {
		const h = hub();
		await relay(h, { to: 'me', from: 'bob', text: '', file: true, ts: 100, conv: 'bob|me' });
		const res = await h.fetch(req('https://dummy/convs'));
		const body = await res.json();
		expect(['📎 file', '📷 image']).toContain(body.convs[0].preview);
	});
});
