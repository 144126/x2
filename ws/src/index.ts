import { relay } from './relay';
import { get_secret, type SecretVal } from '../../src/lib/server/qdrant';

interface Env {
	CHAT_HUB: DurableObjectNamespace;
	MATCH_LOBBY: DurableObjectNamespace;
	CREDIT_ACCOUNT: DurableObjectNamespace;
	SECRET: SecretVal;
	DEV_SECRET?: SecretVal; // local dev only (ws/.dev.vars); see get_secret
	QDRANT_URL: string | { get?: () => Promise<string> };
	QDRANT_KEY: string | { get?: () => Promise<string> };
	X2_ORIGIN?: string; // deployed main worker's origin, e.g. "https://x2.<account>.workers.dev"
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
			if (!uid) {
				console.warn('[WS-WORKER] /ws request with no uid, rejecting');
				return new Response('no uid', { status: 400 });
			}
			console.log(`[WS-WORKER] routing /ws to ChatHub DO for uid=${uid}, upgrade header=${request.headers.get('upgrade')}`);
			const id = env.CHAT_HUB.idFromName(uid);
			const stub = env.CHAT_HUB.get(id);
			const res = await stub.fetch(request);
			console.log(`[WS-WORKER] ChatHub DO responded status=${res.status} for uid=${uid}`);
			return res;
		}

		if (url.pathname === '/relay') {
			const body = await request.json().catch(() => null);
			console.log('[WS-WORKER] /relay body:', body);
			const result = await relay(body, env.CHAT_HUB);
			console.log('[WS-WORKER] /relay result:', result);
			if (!result) return new Response('no target', { status: 400 });
			return Response.json(result, { status: result.ok ? 200 : 502 });
		}

		// /credits/<uid>/balance|deduct|credit — one CreditAccount DO instance per uid
		const credits = url.pathname.match(/^\/credits\/([^/]+)\/(balance|deduct|credit)$/);
		if (credits) {
			const [, uid, action] = credits;
			const id = env.CREDIT_ACCOUNT.idFromName(uid);
			const stub = env.CREDIT_ACCOUNT.get(id);
			const body = request.method === 'POST' ? await request.text() : undefined;
			return stub.fetch(
				new Request(`https://dummy/${action}`, {
					method: request.method,
					headers: { 'content-type': 'application/json' },
					body
				})
			);
		}

		return new Response('x2-ws relay+presence worker', { status: 200 });
	},

	// adapter-cloudflare's generated SvelteKit worker doesn't expose a `scheduled` hook, so the
	// cron trigger lives here instead and calls back into the main worker's internal endpoint,
	// which has the push-notify + socket-relay code that scheduled sends need.
	async scheduled(_event, env): Promise<void> {
		if (!env.X2_ORIGIN) return;
		const secret = await get_secret(env.SECRET, env.DEV_SECRET);
		if (!secret) return;
		await fetch(`${env.X2_ORIGIN}/api/cron/dispatch-scheduled`, {
			method: 'POST',
			headers: { authorization: `Bearer ${secret}` }
		}).catch(() => {});
	}
};

export default worker;
export { ChatHub } from './hub';
export { MatchLobby } from './lobby';
export { CreditAccount } from './credit_account';
