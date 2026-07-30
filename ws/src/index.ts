import { relay } from './relay';
import { online } from './online';
import { get_secret, type SecretVal } from '../../src/lib/server/qdrant';

interface Env {
	CHAT_HUB: DurableObjectNamespace;
	CREDIT_ACCOUNT: DurableObjectNamespace;
	ROOM: DurableObjectNamespace;
	SECRET: SecretVal;
	DEV_SECRET?: SecretVal;
	QDRANT_URL: string | { get?: () => Promise<string> };
	QDRANT_KEY: string | { get?: () => Promise<string> };
	X2_ORIGIN: SecretVal;
}

const worker: ExportedHandler<Env> = {
	async fetch(request, env): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname === '/ws') {
			const uid = url.searchParams.get('uid') ?? '';
			if (!uid) {
				console.warn('[WS-WORKER] /ws request with no uid, rejecting');
				return new Response('no uid', { status: 400 });
			}
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

		if (url.pathname === '/online' && request.method === 'POST') {
			const secret = await get_secret(env.SECRET, env.DEV_SECRET);
			const auth = request.headers.get('authorization');
			if (!secret || auth !== `Bearer ${secret}`) return new Response('denied', { status: 403 });
			const body = await request.json().catch(() => null);
			const uids = await online(body, env.CHAT_HUB);
			if (!uids) return new Response('bad body', { status: 400 });
			return Response.json({ online: uids });
		}

		const hub = url.pathname.match(
			/^\/hub\/([^/]+)\/(unread|read|mute|unmute|mutes|sub|unsub|convs|conv)$/
		);
		if (hub) {
			const secret = await get_secret(env.SECRET, env.DEV_SECRET);
			const auth = request.headers.get('authorization');
			if (!secret || auth !== `Bearer ${secret}`) return new Response('denied', { status: 403 });
			const [, uid, action] = hub;
			const id = env.CHAT_HUB.idFromName(uid);
			const stub = env.CHAT_HUB.get(id);
			const body = request.method === 'POST' ? await request.text() : undefined;
			return stub.fetch(
				new Request(`https://dummy/${action}`, {
					method: request.method,
					headers: { 'content-type': 'application/json' },
					body
				})
			);
		}

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

		if (url.pathname.startsWith('/room/')) {
			const secret = await get_secret(env.SECRET, env.DEV_SECRET);
			const auth = request.headers.get('authorization');
			if (!secret || auth !== `Bearer ${secret}`) return new Response('denied', { status: 403 });
			const segments = url.pathname.split('/');
			if (segments.length < 4) return new Response('bad', { status: 400 });
			const [, , id] = segments;
			const stub = env.ROOM.get(env.ROOM.idFromName(id));
			return stub.fetch(
				new Request(`https://dummy/${segments.slice(3).join('/')}${url.search}`, {
					method: request.method,
					headers: { 'content-type': 'application/json' },
					body: request.method === 'PUT' || request.method === 'DELETE' ? undefined : undefined
				})
			);
		}

		if (url.pathname.startsWith('/room/')) {
			const secret = await get_secret(env.SECRET, env.DEV_SECRET);
			const auth = request.headers.get('authorization');
			if (!secret || auth !== `Bearer ${secret}`) return new Response('denied', { status: 403 });
			const segments = url.pathname.split('/');
			if (segments.length < 4) return new Response('bad', { status: 400 });
			const [, , id] = segments;
			const stub = env.ROOM.get(env.ROOM.idFromName(id));
			const body = request.method === 'POST' ? await request.text() : undefined;
			return stub.fetch(
				new Request(`https://dummy/${segments.slice(3).join('/')}${url.search}`, {
					method: request.method,
					headers: { 'content-type': 'application/json' },
					body
				})
			);
		}

		return new Response('x2-ws relay+presence worker', { status: 200 });
	},

	async scheduled(_event, env): Promise<void> {
		const origin = await get_secret(env.X2_ORIGIN);
		if (!origin) return;
		const secret = await get_secret(env.SECRET, env.DEV_SECRET);
		if (!secret) return;
		await fetch(`${origin}/api/cron/dispatch-scheduled`, {
			method: 'POST',
			headers: { authorization: `Bearer ${secret}` }
		}).catch(() => {});
	}
};

export default worker;
export { ChatHub } from './hub';
export { CreditAccount } from './credit_account';
export { Room } from './room';
