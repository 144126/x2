import { get_secret, type SecretVal } from '../../src/lib/server/qdrant';

interface Env {
	CHAT_HUB: DurableObjectNamespace;
	SECRET: SecretVal;
	DEV_SECRET?: SecretVal; // local dev only (ws/.dev.vars); see get_secret
}

export class ChatHub implements DurableObject {
	private state: DurableObjectState;
	private env: Env;

	constructor(state: DurableObjectState, env: Env) {
		this.state = state;
		this.env = env;
	}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		if (request.headers.get('upgrade') === 'websocket') {
			const uid = url.searchParams.get('uid') ?? '';
			const token = url.searchParams.get('t') ?? '';
			const secret = await get_secret(this.env.SECRET, this.env.DEV_SECRET);
			if (!(await verify_token(secret, uid, token))) {
				return new Response('denied', { status: 403 });
			}
			const pair = new WebSocketPair();
			const [client, server] = Object.values(pair) as unknown as [WebSocket, WebSocket];
			this.state.acceptWebSocket(server, [uid]);
			this.announce(uid, true);
			await this.notify_watchers(uid, true);
			return new Response(null, { status: 101, webSocket: client });
		}
		if (url.pathname === '/relay' && request.method === 'POST') {
			const m = (await request.json()) as { id: string; to: string; from: string; text: string; ts: number; from_name?: string; group?: string; image?: string };
			const delivered = this.deliver(m.to, { type: 'msg', id: m.id, from: m.from, from_name: m.from_name, text: m.text, image: m.image, group: m.group, ts: m.ts });
			return Response.json({ delivered });
		}
		if (url.pathname === '/signal') {
			const msg = (await request.json()) as { to: string };
			this.deliver(msg.to, msg);
			return new Response('ok');
		}
		if (url.pathname === '/check') {
			const online = this.state.getWebSockets().length > 0;
			return new Response(JSON.stringify({ online }));
		}
		if (url.pathname === '/watch' && request.method === 'POST') {
			const { uid } = (await request.json()) as { uid: string };
			const watchers = (await this.state.storage.get<string[]>('watchers')) ?? [];
			if (!watchers.includes(uid)) {
				watchers.push(uid);
				await this.state.storage.put('watchers', watchers);
			}
			return new Response('ok');
		}
		if (url.pathname === '/unwatch' && request.method === 'POST') {
			const { uid } = (await request.json()) as { uid: string };
			const watchers = (await this.state.storage.get<string[]>('watchers')) ?? [];
			const next = watchers.filter((w) => w !== uid);
			if (next.length !== watchers.length) await this.state.storage.put('watchers', next);
			return new Response('ok');
		}
		if (url.pathname === '/notify' && request.method === 'POST') {
			const { uid, online } = (await request.json()) as { uid: string; online: boolean };
			this.announce(uid, online);
			return new Response('ok');
		}
		return new Response('bad', { status: 400 });
	}

	async webSocketMessage(ws: WebSocket, data: string): Promise<void> {
		const msg = JSON.parse(data);
		const self = this.state.getTags(ws)[0];
		if (!self) return;
		if (msg.type === 'ping') {
			try { ws.send(JSON.stringify({ type: 'pong' })); } catch {}
		} else if (msg.type === 'signal') {
			msg.from = self;
			const id = this.env.CHAT_HUB.idFromName(msg.to);
			const stub = this.env.CHAT_HUB.get(id);
			await stub.fetch('https://dummy/signal', { method: 'POST', body: JSON.stringify(msg) });
		} else if (msg.type === 'watch') {
			const id = this.env.CHAT_HUB.idFromName(msg.peer);
			const stub = this.env.CHAT_HUB.get(id);
			await stub.fetch('https://dummy/unwatch', { method: 'POST', body: JSON.stringify({ uid: self }) });
		} else if (msg.type === 'check') {
			const id = this.env.CHAT_HUB.idFromName(msg.peer);
			const stub = this.env.CHAT_HUB.get(id);
			const res = await stub.fetch('https://dummy/check');
			const body = (await res.json()) as { online: boolean };
			ws.send(JSON.stringify({ type: 'presence', uid: msg.peer, online: body.online }));
		}
	}

	async webSocketClose(ws: WebSocket): Promise<void> {
		const uid = this.state.getTags(ws)[0];
		if (uid) {
			this.announce(uid, false);
			await this.notify_watchers(uid, false);
		}
		ws.close();
	}

	private async notify_watchers(uid: string, online: boolean): Promise<void> {
		const watchers = (await this.state.storage.get<string[]>('watchers')) ?? [];
		for (const watcher of watchers) {
			try {
				const id = this.env.CHAT_HUB.idFromName(watcher);
				const stub = this.env.CHAT_HUB.get(id);
				await stub.fetch('https://dummy/notify', {
					method: 'POST',
					body: JSON.stringify({ uid, online })
				});
			} catch {}
		}
	}

	private deliver(uid: string, payload: unknown): boolean {
		const data = JSON.stringify(payload);
		const sockets = this.state.getWebSockets(uid);
		let sent = false;
		for (const ws of sockets) {
			try {
				ws.send(data);
				sent = true;
			} catch (e) {
				console.error(`[HUB-DELIVER] send FAILED for uid=${uid}:`, e);
				try { ws.close(1011, 'delivery failed'); } catch {}
			}
		}
		return sent;
	}

	private announce(uid: string, online: boolean): void {
		const data = JSON.stringify({ type: 'presence', uid, online });
		const allSockets = this.state.getWebSockets();
		console.log(`[HUB-ANNOUNCE] uid=${uid} online=${online} broadcasting to ${allSockets.length} sockets`);
		for (const ws of allSockets) {
			try {
				console.log(`[HUB-ANNOUNCE] sending presence to socket readyState=${ws.readyState}`);
				ws.send(data);
			} catch {}
		}
	}
}

export async function verify_token(secret: string, uid: string, token: string): Promise<boolean> {
	if (!secret || !token) return false;
	const raw = new TextEncoder().encode(`${uid}.${secret}`);
	const sig = await crypto.subtle.digest('SHA-256', raw);
	const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
	return hex === token;
}
