interface Env {
	CHAT_HUB: DurableObjectNamespace;
	MATCH_LOBBY: DurableObjectNamespace;
	SECRET: string | { get?: () => Promise<string> };
	QDRANT_URL: string | { get?: () => Promise<string> };
	QDRANT_KEY: string | { get?: () => Promise<string> };
}

const worker: ExportedHandler<Env> = {
	async fetch(request, env): Promise<Response> {
		const url = new URL(request.url);
		console.log(`[WS-WORKER] ${request.method} ${url.pathname}`);

		if (url.pathname === '/match') {
			const id = env.MATCH_LOBBY.idFromName('lobby');
			const stub = env.MATCH_LOBBY.get(id);
			return stub.fetch(request);
		}

		if (url.pathname === '/ws') {
			const uid = url.searchParams.get('uid') ?? '';
			if (!uid) return new Response('no uid', { status: 400 });
			console.log(`[WS-WORKER] routing /ws to ChatHub DO for uid=${uid}`);
			const id = env.CHAT_HUB.idFromName(uid);
			const stub = env.CHAT_HUB.get(id);
			return stub.fetch(request);
		}

		if (url.pathname === '/relay') {
			console.log(`[WS-RELAY] received relay request`);
			const body = await request.json().catch(() => null) as Record<string, unknown> | null;
			console.log(`[WS-RELAY] body:`, JSON.stringify(body).slice(0, 300));
			// 1:1 sends carry `to`; group sends carry `members` (already filtered to
			// everyone but the sender) and fan out to one hub each.
			const to = body?.to as string | undefined;
			const members = body?.members as string[] | undefined;
			const targets = to ? [to] : (members ?? []);
			if (!targets.length) { console.log(`[WS-RELAY] no target, rejecting`); return new Response('no target', { status: 400 }); }
			console.log(`[WS-RELAY] routing to ${targets.length} hub(s)`);
			const results = await Promise.all(targets.map(async (uid) => {
				const stub = env.CHAT_HUB.get(env.CHAT_HUB.idFromName(uid));
				const resp = await stub.fetch(new Request('https://dummy/relay', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ ...body, to: uid })
				})).catch(() => null);
				return resp?.status ?? 0;
			}));
			console.log(`[WS-RELAY] DO statuses=${results.join(',')}`);
			return new Response('ok', { status: results.some((s) => s === 200) ? 200 : 502 });
		}

		return new Response('x2-ws relay+presence worker', { status: 200 });
	}
};

export default worker;
export { ChatHub } from './hub';
export { MatchLobby } from './lobby';
