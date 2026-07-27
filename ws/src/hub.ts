import { get_secret, type SecretVal } from '../../src/lib/server/qdrant';

interface Env {
	CHAT_HUB: DurableObjectNamespace;
	SECRET: SecretVal;
}

export class ChatHub implements DurableObject {
	private 	state: DurableObjectState;
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
			if (!(await verify_token(await get_secret(this.env.SECRET), uid, token)))
				return new Response('denied', { status: 403 });
			const pair = new WebSocketPair();
			const [client, server] = Object.values(pair) as unknown as [WebSocket, WebSocket];
			this.state.acceptWebSocket(server, [uid]);
			this.announce(uid, true);
			return new Response(null, { status: 101, webSocket: client });
		}
		if (url.pathname === '/relay' && request.method === 'POST') {
			const m = (await request.json()) as { to: string; from: string; text: string; ts: number; from_name?: string };
			this.deliver(m.to, { type: 'msg', from: m.from, from_name: m.from_name, text: m.text, ts: m.ts });
			return new Response('ok');
		}
		if (url.pathname === '/signal') {
			const msg = (await request.json()) as { to: string };
			this.deliver(msg.to, msg);
			return new Response('ok');
		}
		return new Response('bad', { status: 400 });
	}

	async webSocketMessage(ws: WebSocket, data: string): Promise<void> {
		const msg = JSON.parse(data);
		if (msg.type !== 'signal') return;
		msg.from = this.state.getTags(ws)[0];
		const id = this.env.CHAT_HUB.idFromName(msg.to);
		const stub = this.env.CHAT_HUB.get(id);
		await stub.fetch('https://dummy/signal', { method: 'POST', body: JSON.stringify(msg) });
	}

	async webSocketClose(ws: WebSocket): Promise<void> {
		const uid = this.state.getTags(ws)[0];
		if (uid) this.announce(uid, false);
		ws.close();
	}

	private deliver(uid: string, payload: unknown): void {
		const data = JSON.stringify(payload);
		for (const ws of this.state.getWebSockets(uid)) {
			try {
				ws.send(data);
			} catch {}
		}
	}

	private announce(uid: string, online: boolean): void {
		const data = JSON.stringify({ type: 'presence', uid, online });
		for (const ws of this.state.getWebSockets()) {
			try {
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
