import { verify_token } from './hub';
import { search, retrieve_one, eq, f, get_secret, type QEnv, type SecretVal } from '../../src/lib/server/qdrant';
import { conv_id, record_match, get_user_name } from '../../src/lib/server/chat';

interface Env extends QEnv {
	SECRET: SecretVal;
	DEV_SECRET?: SecretVal; // local dev only (ws/.dev.vars); see get_secret
}

type WaitingEntry = { uid: string; name: string };

const WAITING_KEY = 'waiting';

// Omegle-style random matching: a single global DO instance (see index.ts: always
// idFromName('lobby')) holds the waiting queue in durable storage (plain instance fields don't
// survive DO hibernation) and pairs people by embedding similarity to their own profile vector,
// falling back to first-come-first-served when a profile has no embedding yet. The lobby
// connection only lives for the search itself — once matched, the client disconnects and moves
// to the real chat (ChatHub), whose existing presence system already covers "peer went offline";
// no separate partner-notification bookkeeping is needed here.
// ponytail: one global queue is a throughput ceiling — fine for MVP scale, shard by
// region/interest pool if simultaneous searchers ever become a bottleneck.
export class MatchLobby implements DurableObject {
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
			if (!(await verify_token(await get_secret(this.env.SECRET, this.env.DEV_SECRET), uid, token)))
				return new Response('denied', { status: 403 });
			const pair = new WebSocketPair();
			const [client, server] = Object.values(pair) as unknown as [WebSocket, WebSocket];
			this.state.acceptWebSocket(server, [uid]);
			const name = await get_user_name(this.env, uid);
			await this.try_match(uid, name);
			return new Response(null, { status: 101, webSocket: client });
		}
		return new Response('bad', { status: 400 });
	}

	async webSocketClose(ws: WebSocket): Promise<void> {
		const uid = this.state.getTags(ws)[0];
		if (uid) await this.remove_waiting(uid);
		ws.close();
	}

	private async get_waiting(): Promise<WaitingEntry[]> {
		return (await this.state.storage.get<WaitingEntry[]>(WAITING_KEY)) ?? [];
	}

	private async set_waiting(list: WaitingEntry[]): Promise<void> {
		await this.state.storage.put(WAITING_KEY, list);
	}

	private async remove_waiting(uid: string): Promise<void> {
		const waiting = await this.get_waiting();
		const next = waiting.filter((w) => w.uid !== uid);
		if (next.length !== waiting.length) await this.set_waiting(next);
	}

	private deliver(uid: string, payload: unknown): void {
		const data = JSON.stringify(payload);
		for (const ws of this.state.getWebSockets(uid)) {
			try {
				ws.send(data);
			} catch {}
		}
	}

	// pairs uid with the best available waiting candidate: ranked by embedding similarity to
	// uid's own profile vector when one exists, otherwise first-in-queue.
	private async try_match(uid: string, name: string): Promise<void> {
		let waiting = (await this.get_waiting()).filter((w) => w.uid !== uid);
		// drop stale entries whose socket is no longer connected
		waiting = waiting.filter((w) => this.state.getWebSockets(w.uid).length > 0);

		let partner: WaitingEntry | undefined;
		if (waiting.length) {
			const self_pt = await retrieve_one(this.env, uid, true);
			const self_vec = self_pt?.vector;
			if (self_vec && self_vec.some((x) => x !== 0)) {
				const ranked = await search(this.env, self_vec, f(eq('s', 'u')), waiting.length + 5);
				const waiting_by_uid = new Map(waiting.map((w) => [w.uid, w]));
				for (const hit of ranked) {
					const candidate = waiting_by_uid.get(String(hit.id));
					if (candidate) {
						partner = candidate;
						break;
					}
				}
			}
			if (!partner) partner = waiting[0];
		}

		if (partner) {
			const remaining = (await this.get_waiting()).filter(
				(w) => w.uid !== partner!.uid && w.uid !== uid
			);
			await this.set_waiting(remaining);
			await record_match(this.env, uid, partner.uid);
			const cid = conv_id(uid, partner.uid);
			this.deliver(uid, { type: 'matched', peer: partner.uid, peer_name: partner.name, conv: cid });
			this.deliver(partner.uid, { type: 'matched', peer: uid, peer_name: name, conv: cid });
		} else {
			const list = await this.get_waiting();
			await this.set_waiting([...list.filter((w) => w.uid !== uid), { uid, name }]);
			this.deliver(uid, { type: 'searching' });
		}
	}
}
