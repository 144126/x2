import { verify_token } from './hub';
import {
	search,
	retrieve_one,
	eq,
	f,
	get_secret,
	type QEnv,
	type SecretVal
} from '../../src/lib/server/qdrant';
import { conv_id, get_user_name } from '../../src/lib/server/chat';

interface Env extends QEnv {
	SECRET: SecretVal;
	DEV_SECRET?: SecretVal; // local dev only; see get_secret
}

type Waiting = { uid: string; name: string; avoid: string[] };

const WAITING_KEY = 'waiting';

/** how many recent partners a "next" remembers, so skipping never loops straight back */
const AVOID = 3;

// One global DO instance (index.ts always uses idFromName('lobby')) holds everyone who is
// looking for a random voice chat. Pairing prefers the waiting person whose profile embedding
// is closest to yours and falls back to first-come-first-served, which is also what happens
// for a brand-new account with no profile yet. The socket stays open for the whole session:
// it is how "next" puts you back in the queue without a reconnect.
//
// ponytail: one global queue is a throughput ceiling — fine at this scale, shard by region or
// interest pool if simultaneous searchers ever become the bottleneck.
export class MatchLobby implements DurableObject {
	private state: DurableObjectState;
	private env: Env;

	constructor(state: DurableObjectState, env: Env) {
		this.state = state;
		this.env = env;
	}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		if (request.headers.get('upgrade') !== 'websocket') return new Response('bad', { status: 400 });

		const uid = url.searchParams.get('uid') ?? '';
		const token = url.searchParams.get('t') ?? '';
		const exp = Number(url.searchParams.get('exp') ?? 0);
		const secret = await get_secret(this.env.SECRET, this.env.DEV_SECRET);
		if (!secret || !(await verify_token(secret, uid, exp, token)))
			return new Response('denied', { status: 403 });

		const pair = new WebSocketPair();
		const [client, server] = Object.values(pair) as unknown as [WebSocket, WebSocket];
		this.state.acceptWebSocket(server, [uid]);
		const name = await get_user_name(this.env, uid);
		await this.try_match(uid, name, []);
		return new Response(null, { status: 101, webSocket: client });
	}

	async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
		const uid = this.state.getTags(ws)[0];
		if (!uid || typeof raw !== 'string') return;
		const m = JSON.parse(raw) as { type?: string; skip?: string };
		if (m.type === 'again') {
			const name = await get_user_name(this.env, uid);
			await this.try_match(uid, name, m.skip ? [m.skip] : []);
		} else if (m.type === 'stop') {
			await this.remove(uid);
		}
	}

	async webSocketClose(ws: WebSocket): Promise<void> {
		const uid = this.state.getTags(ws)[0];
		if (uid) await this.remove(uid);
	}

	async webSocketError(ws: WebSocket): Promise<void> {
		await this.webSocketClose(ws);
	}

	private async get_waiting(): Promise<Waiting[]> {
		return (await this.state.storage.get<Waiting[]>(WAITING_KEY)) ?? [];
	}

	private async set_waiting(list: Waiting[]): Promise<void> {
		await this.state.storage.put(WAITING_KEY, list);
		for (const w of list) this.deliver(w.uid, { type: 'waiting', n: list.length });
	}

	private async remove(uid: string): Promise<void> {
		const waiting = await this.get_waiting();
		const next = waiting.filter((w) => w.uid !== uid);
		if (next.length !== waiting.length) await this.set_waiting(next);
	}

	private deliver(uid: string, payload: unknown): void {
		const data = JSON.stringify(payload);
		for (const ws of this.state.getWebSockets(uid)) {
			try {
				ws.send(data);
			} catch {
				/* a dead socket is cleaned up by webSocketClose */
			}
		}
	}

	/** interests both people typed, so the match can say why it happened */
	private async common(a: string, b: string): Promise<string[]> {
		const [pa, pb] = await Promise.all([retrieve_one(this.env, a), retrieve_one(this.env, b)]);
		const ia = ((pa?.payload?.i as string[]) ?? []).map((s) => s.toLowerCase());
		const ib = new Set(((pb?.payload?.i as string[]) ?? []).map((s) => s.toLowerCase()));
		return ia.filter((t) => ib.has(t)).slice(0, 4);
	}

	private async try_match(uid: string, name: string, skip: string[]): Promise<void> {
		const queue = await this.get_waiting();
		const mine = queue.find((w) => w.uid === uid);
		const avoid = [...skip, ...(mine?.avoid ?? [])].slice(0, AVOID);

		// a queue entry whose socket has gone is stale — never pair anyone with it
		const others = queue.filter(
			(w) => w.uid !== uid && this.state.getWebSockets(w.uid).length > 0 && !avoid.includes(w.uid)
		);

		let partner: Waiting | undefined;
		if (others.length) {
			const self = await retrieve_one(this.env, uid, true);
			const vec = self?.vector;
			if (vec && vec.some((x) => x !== 0)) {
				const ranked = await search(this.env, vec, f(eq('s', 'u')), others.length + 5);
				const by_uid = new Map(others.map((w) => [w.uid, w]));
				for (const hit of ranked) {
					const candidate = by_uid.get(String(hit.id));
					if (candidate) {
						partner = candidate;
						break;
					}
				}
			}
			partner ??= others[0];
		}

		if (!partner) {
			const rest = queue.filter((w) => w.uid !== uid);
			const list = [...rest, { uid, name, avoid }];
			await this.set_waiting(list);
			this.deliver(uid, { type: 'searching', n: list.length });
			return;
		}

		await this.set_waiting(queue.filter((w) => w.uid !== uid && w.uid !== partner!.uid));
		const conv = conv_id(uid, partner.uid);
		const shared = await this.common(uid, partner.uid);
		this.deliver(uid, {
			type: 'matched',
			peer: partner.uid,
			peer_name: partner.name,
			conv,
			shared
		});
		this.deliver(partner.uid, { type: 'matched', peer: uid, peer_name: name, conv, shared });
	}
}
