import { get_secret, uuid_from, type SecretVal } from '../../src/lib/server/qdrant';
import { send_push, clamp_payload, push_topic, type PushKeys } from '../../src/lib/server/push';

interface Env {
	CHAT_HUB: DurableObjectNamespace;
	SECRET: SecretVal;
	DEV_SECRET?: SecretVal;
	VAPID_PUBLIC?: SecretVal;
	VAPID_PRIVATE?: SecretVal;
	VAPID_SUBJECT?: SecretVal;
}

type UnreadEntry = { n: number; mute_key: string };
type ConvEntry = { peer?: string; group?: string; last: number; preview: string };
type MuteEntry = { k: 'u' | 'r'; until: number };
type SubEntry = { ep: string; k: string; au: string; ua?: string; d: number };

const is_mute_active = (m: MuteEntry, now = Date.now()): boolean => m.until === 0 || m.until > now;

export class ChatHub implements DurableObject {
	private state: DurableObjectState;
	private env: Env;

	constructor(state: DurableObjectState, env: Env) {
		this.state = state;
		this.env = env;
		state.setWebSocketAutoResponse(
			new WebSocketRequestResponsePair(
				JSON.stringify({ type: 'ping' }),
				JSON.stringify({ type: 'pong' })
			)
		);
	}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		if (request.headers.get('upgrade') === 'websocket') {
			const proto = request.headers.get('sec-websocket-protocol') ?? '';
			const parts = proto.match(/^x2\.([^.]+)\.(\d+)\.([0-9a-f]{64})$/);
			if (!parts) {
				console.warn('[HUB-WS-UPGRADE] missing or malformed auth subprotocol');
				return new Response('denied', { status: 403 });
			}
			const [, uid, exp, token] = parts;
			const secret = await get_secret(this.env.SECRET, this.env.DEV_SECRET);
			const valid = await verify_token(secret, uid, Number(exp), token);
			if (!valid) {
				console.warn(`[HUB-WS-UPGRADE] DENIED uid=${uid}`);
				return new Response('denied', { status: 403 });
			}
			const pair = new WebSocketPair();
			const [client, server] = Object.values(pair) as unknown as [WebSocket, WebSocket];
			this.state.acceptWebSocket(server, [uid]);
			this.announce(uid, true);
			await this.notify_watchers(uid, true);
			return new Response(null, { status: 101, webSocket: client, headers: { 'sec-websocket-protocol': proto } });
		}
		if (url.pathname === '/relay' && request.method === 'POST') {
			const body = (await request.json()) as Record<string, unknown>;
			const to = body.to as string;
			const type = (body.type as string) ?? 'msg';
			const payload = build_relay_payload(type, body);
			const conv = typeof body.conv === 'string' ? body.conv : undefined;
			const mute_key = typeof body.mute_key === 'string' ? body.mute_key : undefined;
			if (type === 'msg' && conv) {
				await this.bump_unread(conv, mute_key ?? '');
				await this.state.storage.put('conv:' + conv, {
					...(body.group ? { group: body.group as string } : { peer: body.from as string }),
					last: body.ts as number,
					preview: (body.text as string) || (body.file ? '📎 file' : '📷 image')
				});
			}
			const delivered = this.deliver(to, payload);
			if (type === 'msg' && !delivered) {
				const muted = mute_key ? await this.is_muted(mute_key) : false;
				if (!muted) {
					await this.send_push_notification({
						title: body.title as string | undefined,
						body: body.push_body as string | undefined,
						url: body.url as string | undefined,
						conv,
						id: body.id as string | undefined,
						ts: body.ts as number | undefined,
						kind: body.kind as string | undefined,
						reply_to: body.reply_to as string | undefined,
						image: body.image as string | undefined
					});
				}
			}
			return Response.json({ delivered });
		}
		if (url.pathname === '/signal') {
			const msg = (await request.json()) as { to: string };
			this.deliver(msg.to, msg);
			return new Response('ok');
		}
		if (url.pathname === '/check') {
			const online = this.state.getWebSockets().some((ws) => {
				const att = ws.deserializeAttachment() as { active?: boolean } | null;
				return att?.active !== false;
			});
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
		if (url.pathname === '/convs' && request.method === 'GET') {
			const convs = await this.list_convs();
			return Response.json({ convs });
		}
		if (url.pathname === '/sv' && request.method === 'GET') {
			const sv = (await this.state.storage.get<number>('sv')) ?? 0;
			return Response.json({ sv });
		}
		if (url.pathname === '/sv' && request.method === 'POST') {
			const { sv } = (await request.json()) as { sv: number };
			await this.state.storage.put('sv', sv);
			return new Response('ok');
		}
		if (url.pathname === '/conv' && request.method === 'POST') {
			const body = (await request.json()) as {
				conv: string;
				peer?: string;
				group?: string;
				last: number;
				preview: string;
			};
			await this.state.storage.put('conv:' + body.conv, {
				...(body.group ? { group: body.group } : { peer: body.peer }),
				last: body.last,
				preview: body.preview
			});
			return new Response('ok');
		}
		if (url.pathname === '/unread' && request.method === 'GET') {
			const { total, by_conv } = await this.unread_totals();
			return Response.json({ total, by_conv });
		}
		if (url.pathname === '/read' && request.method === 'POST') {
			const { conv, ts } = (await request.json()) as { conv: string; ts?: number };
			const prev = (await this.state.storage.get<number>('read:' + conv)) ?? 0;
			await this.state.storage.put('read:' + conv, Math.max(prev, ts ?? Date.now()));
			await this.state.storage.delete('unread:' + conv);
			const { total } = await this.unread_totals();
			return Response.json({ total });
		}
		if (url.pathname === '/mute' && request.method === 'POST') {
			const { target, kind, until } = (await request.json()) as {
				target: string;
				kind: 'u' | 'r';
				until: number;
			};
			await this.state.storage.put('mute:' + target, { k: kind, until });
			return new Response('ok');
		}
		if (url.pathname === '/unmute' && request.method === 'POST') {
			const { target } = (await request.json()) as { target: string };
			await this.state.storage.delete('mute:' + target);
			return new Response('ok');
		}
		if (url.pathname === '/mutes' && request.method === 'GET') {
			const list = await this.state.storage.list<MuteEntry>({ prefix: 'mute:' });
			const now = Date.now();
			const mutes = [...list.entries()]
				.filter(([, m]) => is_mute_active(m, now))
				.map(([key, m]) => ({ tg: key.slice('mute:'.length), k: m.k, until: m.until }));
			return Response.json({ mutes });
		}
		if (url.pathname === '/sub' && request.method === 'POST') {
			const body = (await request.json()) as { ep: string; k: string; au: string; ua?: string };
			const key = 'sub:' + (await uuid_from(body.ep));
			const entry: SubEntry = {
				ep: body.ep,
				k: body.k,
				au: body.au,
				...(body.ua ? { ua: body.ua } : {}),
				d: Date.now()
			};
			await this.state.storage.put(key, entry);
			return new Response('ok');
		}
		if (url.pathname === '/unsub' && request.method === 'POST') {
			const { ep } = (await request.json()) as { ep: string };
			await this.state.storage.delete('sub:' + (await uuid_from(ep)));
			return new Response('ok');
		}
		return new Response('bad', { status: 400 });
	}

	async webSocketMessage(ws: WebSocket, data: string): Promise<void> {
		const msg = JSON.parse(data);
		const self = this.state.getTags(ws)[0];
		if (!self) return;
		if (msg.type === 'signal') {
			msg.from = self;
			const id = this.env.CHAT_HUB.idFromName(msg.to);
			const stub = this.env.CHAT_HUB.get(id);
			await stub.fetch('https://dummy/signal', { method: 'POST', body: JSON.stringify(msg) });
		} else if (msg.type === 'active') {
			ws.serializeAttachment({ active: msg.on === true });
		} else if (msg.type === 'watch') {
			const id = this.env.CHAT_HUB.idFromName(msg.peer);
			const stub = this.env.CHAT_HUB.get(id);
			await stub.fetch('https://dummy/unwatch', {
				method: 'POST',
				body: JSON.stringify({ uid: self })
			});
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
		ws.close();
		if (uid && this.state.getWebSockets(uid).length === 0) {
			this.announce(uid, false);
			await this.notify_watchers(uid, false);
		}
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
		let seen = false;
		for (const ws of sockets) {
			try {
				ws.send(data);
				const att = ws.deserializeAttachment() as { active?: boolean } | null;
				if (att?.active !== false) seen = true;
			} catch (e) {
				console.error(`[HUB-DELIVER] send FAILED for uid=${uid}:`, e);
				try {
					ws.close(1011, 'delivery failed');
				} catch {}
			}
		}
		return seen;
	}

	private announce(uid: string, online: boolean): void {
		const data = JSON.stringify({ type: 'presence', uid, online });
		const allSockets = this.state.getWebSockets();
		for (const ws of allSockets) {
			try {
				ws.send(data);
			} catch {}
		}
	}

	// Atomic by construction: Workers serializes concurrent fetch() calls to the same DO
	// instance, so this read-modify-write needs no CAS — same guarantee credit_account.ts
	// documents and relies on.
	private async bump_unread(conv: string, mute_key: string): Promise<void> {
		const key = 'unread:' + conv;
		const cur = (await this.state.storage.get<UnreadEntry>(key)) ?? { n: 0, mute_key };
		await this.state.storage.put(key, { n: cur.n + 1, mute_key: cur.mute_key || mute_key });
	}

	private async unread_totals(): Promise<{ total: number; by_conv: Record<string, number> }> {
		const entries = await this.state.storage.list<UnreadEntry>({ prefix: 'unread:' });
		const by_conv: Record<string, number> = {};
		let total = 0;
		for (const [key, entry] of entries) {
			if (entry.mute_key && (await this.is_muted(entry.mute_key))) continue;
			const conv = key.slice('unread:'.length);
			by_conv[conv] = entry.n;
			total += entry.n;
		}
		return { total, by_conv };
	}

	private async list_convs(): Promise<
		({ peer?: string; group?: string; last: number; preview: string; unread: number })[]
	> {
		const raw = await this.state.storage.list<ConvEntry>({ prefix: 'conv:' });
		const out: ({ peer?: string; group?: string; last: number; preview: string; unread: number })[] =
			[];
		for (const [key, entry] of raw) {
			const conv = key.slice('conv:'.length);
			if (entry.peer && (await this.is_muted(entry.peer))) continue;
			const unread = (await this.state.storage.get<UnreadEntry>('unread:' + conv))?.n ?? 0;
			out.push({ ...entry, unread });
		}
		return out.sort((a, b) => b.last - a.last);
	}

	private async is_muted(target: string): Promise<boolean> {
		const m = await this.state.storage.get<MuteEntry>('mute:' + target);
		return !!m && is_mute_active(m);
	}

	private async send_push_notification(msg: {
		title?: string;
		body?: string;
		url?: string;
		conv?: string;
		id?: string;
		ts?: number;
		kind?: string;
		reply_to?: string;
		image?: string;
	}): Promise<void> {
		const pub = await get_secret(this.env.VAPID_PUBLIC);
		const priv = await get_secret(this.env.VAPID_PRIVATE);
		const subject = await get_secret(this.env.VAPID_SUBJECT);
		if (!pub || !priv || !subject) return;
		const keys: PushKeys = { public: pub, private: priv, subject };

		const subs = await this.state.storage.list<SubEntry>({ prefix: 'sub:' });
		if (!subs.size) return;

		const { total: unread } = await this.unread_totals();
		const payload = clamp_payload({ ...msg, unread });
		const opts = msg.conv ? { topic: push_topic(msg.conv) } : {};

		const gone: string[] = [];
		await Promise.all(
			[...subs.entries()].map(async ([key, sub]) => {
				const r = await send_push(
					{ endpoint: sub.ep, keys: { p256dh: sub.k, auth: sub.au } },
					payload,
					keys,
					opts
				);
				if (r.gone) gone.push(key);
			})
		);
		if (gone.length) await this.state.storage.delete(gone);
	}
}

function build_relay_payload(type: string, body: Record<string, unknown>): Record<string, unknown> {
	if (type === 'edit') {
		return { type: 'edit', id: body.id, from: body.from, text: body.text, e: body.e, ts: body.ts };
	}
	if (type === 'delete') {
		return { type: 'delete', id: body.id };
	}
	if (type === 'reaction') {
		return { type: 'reaction', id: body.id, rx: body.rx };
	}
	return {
		type: 'msg',
		id: body.id,
		from: body.from,
		from_name: body.from_name,
		text: body.text,
		image: body.image,
		file: body.file,
		group: body.group,
		reply_msg: body.reply_msg,
		ts: body.ts
	};
}

export async function verify_token(secret: string, uid: string, exp: number, token: string): Promise<boolean> {
	if (!secret || !token || !exp) return false;
	if (exp < Date.now()) return false;
	const k = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(secret).slice(0, 32),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	const raw = new TextEncoder().encode(`${uid}.${exp}`);
	const sig = await crypto.subtle.sign('HMAC', k, raw);
	const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
	return hex === token;
}
