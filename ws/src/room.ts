export class Room implements DurableObject {
	private state: DurableObjectState;

	constructor(state: DurableObjectState, _env: unknown) {
		this.state = state;
	}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname === '/join' && request.method === 'POST') {
			const { uid } = (await request.json()) as { uid: string };
			await this.state.storage.put('m:' + uid, Date.now());
			const members = await this.list_members();
			return Response.json({ members });
		}

		if (url.pathname === '/leave' && request.method === 'POST') {
			const { uid } = (await request.json()) as { uid: string };
			await this.state.storage.delete('m:' + uid);
			const members = await this.list_members();
			return Response.json({ members });
		}

		if (url.pathname === '/members' && request.method === 'GET') {
			return Response.json({ members: await this.list_members() });
		}

		if (url.pathname === '/is-member' && request.method === 'GET') {
			const uid = url.searchParams.get('uid');
			if (!uid) return Response.json({ ok: false });
			const v = await this.state.storage.get('m:' + uid);
			return Response.json({ ok: v !== undefined && v !== null });
		}

		return new Response('bad', { status: 400 });
	}

	private async list_members(): Promise<string[]> {
		const entries = await this.state.storage.list<string>({ prefix: 'm:' });
		return [...entries.keys()].map((k) => k.slice(2));
	}
}
