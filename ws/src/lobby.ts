import { verify_token } from './hub';
import {
	search,
	retrieve_one,
	eq,
	f,
	get_secret,
	V,
	type QEnv,
	type SecretVal
} from '../../src/lib/server/qdrant';
import { conv_id, get_user_name } from '../../src/lib/server/chat';

interface Env extends QEnv {
	SECRET: SecretVal;
	DEV_SECRET?: SecretVal; // local dev only; see get_secret
	CHAT_HUB: {
		idFromName(n: string): unknown;
		get(id: unknown): { fetch(r: Request): Promise<Response> };
	};
}

type Waiting = { uid: string; name: string; avoid: string[] };
/** someone who left the site and asked to be pinged when it is worth coming back */
type Parked = { uid: string; at: number; pinged?: number; tz?: string };

const WAITING_KEY = 'waiting';
const PARK_KEY = 'park';

/** how many recent partners a "next" remembers, so skipping never loops straight back */
const AVOID = 3;

/** a park is forgotten after this, so nobody is pinged about a site they left for good */
export const PARK_TTL = 24 * 3600_000;
/** never ping the same person twice inside this window */
export const PING_COOLDOWN = 3 * 3600_000;
/** how long to wait before pinging the next pair when nobody answered */
export const RETRY_MS = 2 * 60_000;
/**
 * How many people one sweep wakes.
 *
 * Two was wrong. If p is the chance a woken person shows up, waking 2 leaves a ~42%
 * chance that exactly one arrives and finds nobody, and produces the fewest
 * conversations per ping. Waking 6 roughly triples conversations-per-ping AND cuts the
 * arrived-alone case, because everyone woken is a candidate for everyone else. The
 * scarce resource is how OFTEN you may ping a person, not how many you ping at once —
 * so the cap belongs on frequency (PING_COOLDOWN), not here.
 */
export const BATCH = 6;
/** local hours that count as night, when no ping is worth sending */
export const NIGHT_FROM = 23;
export const NIGHT_TO = 8;

/** true when it is the middle of the night where this person is */
export function asleep(tz: string | undefined, now: number): boolean {
	if (!tz) return false;
	try {
		const h =
			Number(
				new Date(now).toLocaleString('en-US', { timeZone: tz, hour: '2-digit', hour12: false })
			) % 24;
		return h >= NIGHT_FROM || h < NIGHT_TO;
	} catch {
		// an unknown timezone must never block a ping
		return false;
	}
}

// One global DO instance (index.ts always uses idFromName('lobby')) holds everyone who is
// looking for a random voice chat. Pairing prefers the waiting person whose profile embedding
// is closest to yours and falls back to first-come-first-served, which is also what happens
// for a brand-new account with no profile yet. The socket stays open for the whole session:
// it is how "next" puts you back in the queue without a reconnect.
//
// The park is the answer to an empty queue. People who leave can ask to be pinged, and the
// lobby wakes them in PAIRS — two people arriving inside the same couple of minutes match
// each other, so the feature works even when literally nobody is online, which is exactly
// when it is needed. Waking everyone at once would be worse than not waking anyone.
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
		// deliberately NOT unparked here: someone who taps the notification, shows up and
		// finds nobody would otherwise lose their place for doing exactly the right thing.
		// wake() already skips anyone with an open socket, so being here is enough.
		const name = await get_user_name(this.env, uid);
		await this.try_match(uid, name, []);
		return new Response(null, { status: 101, webSocket: client });
	}

	async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
		const uid = this.state.getTags(ws)[0];
		if (!uid || typeof raw !== 'string') return;
		const m = JSON.parse(raw) as { type?: string; skip?: string; tz?: string };
		if (m.type === 'again') {
			const name = await get_user_name(this.env, uid);
			await this.try_match(uid, name, m.skip ? [m.skip] : []);
		} else if (m.type === 'stop') {
			await this.remove(uid);
		} else if (m.type === 'park') {
			await this.park(uid, m.tz);
			this.deliver(uid, { type: 'parked' });
		} else if (m.type === 'unpark') {
			await this.unpark(uid);
		}
	}

	async webSocketClose(ws: WebSocket): Promise<void> {
		const uid = this.state.getTags(ws)[0];
		if (uid) await this.remove(uid);
	}

	async webSocketError(ws: WebSocket): Promise<void> {
		await this.webSocketClose(ws);
	}

	/** nobody answered the last ping — wake the next pair, and drop stale parks */
	async alarm(): Promise<void> {
		await this.wake();
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

	private async get_park(): Promise<Parked[]> {
		return (await this.state.storage.get<Parked[]>(PARK_KEY)) ?? [];
	}

	private async set_park(list: Parked[]): Promise<void> {
		await this.state.storage.put(PARK_KEY, list);
		// the alarm only has to exist while somebody is parked
		if (list.length) await this.state.storage.setAlarm(Date.now() + RETRY_MS);
		else await this.state.storage.deleteAlarm();
	}

	private async park(uid: string, tz?: string): Promise<void> {
		const list = (await this.get_park()).filter((p) => p.uid !== uid);
		await this.set_park([...list, { uid, at: Date.now(), tz }]);
		await this.wake();
	}

	private async unpark(uid: string): Promise<void> {
		const list = await this.get_park();
		const next = list.filter((p) => p.uid !== uid);
		if (next.length !== list.length) await this.set_park(next);
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

	/**
	 * Wake a pair of parked people, if waking anyone is worth it.
	 *
	 * With somebody already searching, one arrival makes a match. With nobody searching,
	 * it takes two — which is the whole point: two parked people woken together match each
	 * other, so an empty site can still produce a conversation.
	 */
	private async wake(): Promise<void> {
		const now = Date.now();
		const stored = await this.get_park();
		const park = stored.filter((p) => now - p.at < PARK_TTL);
		const searching = (await this.get_waiting()).length;

		const eligible = park.filter(
			(p) =>
				now - (p.pinged ?? 0) > PING_COOLDOWN &&
				!asleep(p.tz, now) &&
				this.state.getWebSockets(p.uid).length === 0
		);

		const batch = eligible.length >= (searching ? 1 : 2) ? eligible.slice(0, BATCH) : [];
		const woken = new Set(batch.map((p) => p.uid));
		const next = park.map((p) => (woken.has(p.uid) ? { ...p, pinged: now } : p));

		// Persist BEFORE sending anything. The pushes are awaited network calls, and a
		// second wake arriving during them would otherwise read the old park and ping the
		// same people twice.
		if (batch.length || next.length !== stored.length) await this.set_park(next);
		// Nothing changed, so set_park never ran — but the sweep still has to survive, or
		// a park full of people in cooldown loses its alarm and goes silent forever.
		else if (next.length) await this.state.storage.setAlarm(now + RETRY_MS);

		// only claim someone is waiting when someone actually is; otherwise this is a
		// small round being started, and the copy says so
		const body = searching
			? 'someone is waiting to talk right now'
			: 'a few people are about to talk — join them';
		await Promise.all(batch.map((p) => this.ping(p.uid, body)));
	}

	private async ping(uid: string, body: string): Promise<void> {
		try {
			const stub = this.env.CHAT_HUB.get(this.env.CHAT_HUB.idFromName(uid));
			await stub.fetch(
				new Request('https://dummy/push', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({
						title: 'x2',
						body,
						// deep-links straight into the search, so the moment is not spent on a button
						url: '/?talk=1'
					})
				})
			);
		} catch (e) {
			console.error(`[LOBBY] ping ${uid} failed:`, e);
		}
	}

	/**
	 * The waiting person whose profile embedding sits closest to this one.
	 *
	 * Vectors in this collection are NAMED, so a retrieved point carries
	 * `{ t: [...] }` — never a bare array. Reading it as an array is what threw
	 * `vec.some is not a function` and broke every pairing in production.
	 */
	private async best_of(uid: string, others: Waiting[]): Promise<Waiting | undefined> {
		const raw = (await retrieve_one(this.env, uid, true))?.vector;
		const vec = Array.isArray(raw) ? raw : raw?.[V];
		if (!vec?.some((x) => x !== 0)) return undefined;

		const ranked = await search(this.env, vec, f(eq('s', 'u')), others.length + 5);
		const by_uid = new Map(others.map((w) => [w.uid, w]));
		for (const hit of ranked) {
			const candidate = by_uid.get(String(hit.id));
			if (candidate) return candidate;
		}
		return undefined;
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

		// Ranking is a bonus; being paired at all is the product. Anything that goes wrong
		// picking the BEST partner must fall through to the first person waiting, never
		// take the rendezvous down with it — this whole block threw a TypeError in
		// production and 500'd the websocket handshake for every second searcher.
		let partner: Waiting | undefined;
		if (others.length) {
			partner = await this.best_of(uid, others).catch((e) => {
				console.error('[LOBBY] ranking failed, falling back to first waiting:', e);
				return undefined;
			});
			partner ??= others[0];
		}

		if (!partner) {
			const rest = queue.filter((w) => w.uid !== uid);
			const list = [...rest, { uid, name, avoid }];
			await this.set_waiting(list);
			this.deliver(uid, { type: 'searching', n: list.length });
			// somebody is now waiting with nobody to talk to — a good moment to wake people
			await this.wake();
			return;
		}

		await this.set_waiting(queue.filter((w) => w.uid !== uid && w.uid !== partner!.uid));
		// they got what they were waiting for, so the standing request is spent
		await this.unpark(uid);
		await this.unpark(partner.uid);
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
