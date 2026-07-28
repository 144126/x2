import { relay } from './relay';

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
			const body = await request.json().catch(() => null);
			const result = await relay(body, env.CHAT_HUB);
			if (!result) return new Response('no target', { status: 400 });
			return Response.json(result, { status: result.ok ? 200 : 502 });
		}

		return new Response('x2-ws relay+presence worker', { status: 200 });
	}
};

export default worker;
export { ChatHub } from './hub';
export { MatchLobby } from './lobby';
