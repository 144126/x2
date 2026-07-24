interface Env {
	CHAT_HUB: DurableObjectNamespace;
	SECRET: string | { get?: () => Promise<string> };
}

const worker: ExportedHandler<Env> = {
	async fetch(request, env): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname === '/ws' || url.pathname === '/relay') {
			const uid = url.pathname === '/ws' ? url.searchParams.get('uid') ?? '' : '';
			const to = url.searchParams.get('to') ?? '';
			const target = uid || to;
			if (!target) return new Response('no target', { status: 400 });
			const id = env.CHAT_HUB.idFromName(target);
			const stub = env.CHAT_HUB.get(id);
			return stub.fetch(request);
		}

		return new Response('x2-ws relay+presence worker', { status: 200 });
	}
};

export default worker;
export { ChatHub } from './hub';
