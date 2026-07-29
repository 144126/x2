// One Durable Object instance per uid. Workers serializes concurrent fetch() calls to the
// same DO instance (input/output gates), so read-modify-write balance mutations here are
// atomic by construction — unlike a bare Qdrant read-then-write, no CAS is needed.

export const DAILY_GRANT = 5400; // kobo, per spec: 5400 free credits/day
const DAY_MS = 86_400_000;

type Balance = { balance: number; last_grant: number };
type DeductResult = { ok: true; balance: number } | { ok: false; reason: 'insufficient_credits'; balance: number };

export class CreditAccount implements DurableObject {
	private state: DurableObjectState;

	constructor(state: DurableObjectState, _env: unknown) {
		this.state = state;
	}

	private async read(): Promise<Balance> {
		const balance = (await this.state.storage.get<number>('balance')) ?? 0;
		const last_grant = (await this.state.storage.get<number>('last_grant')) ?? 0;
		return { balance, last_grant };
	}

	private async maybe_grant(now: number): Promise<Balance & { granted: boolean }> {
		const cur = await this.read();
		if (now - cur.last_grant < DAY_MS) return { ...cur, granted: false };
		const balance = cur.balance + DAILY_GRANT;
		await this.state.storage.put('balance', balance);
		await this.state.storage.put('last_grant', now);
		return { balance, last_grant: now, granted: true };
	}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		const now = Date.now();

		if (url.pathname === '/balance' && request.method === 'GET') {
			const { balance, granted } = await this.maybe_grant(now);
			return Response.json({ balance, granted_today: granted });
		}

		if (url.pathname === '/deduct' && request.method === 'POST') {
			const { amount } = (await request.json()) as { amount: number };
			const { balance } = await this.maybe_grant(now);
			if (balance < amount) {
				const result: DeductResult = { ok: false, reason: 'insufficient_credits', balance };
				return Response.json(result);
			}
			const next = balance - amount;
			await this.state.storage.put('balance', next);
			const result: DeductResult = { ok: true, balance: next };
			return Response.json(result);
		}

		if (url.pathname === '/credit' && request.method === 'POST') {
			const { amount } = (await request.json()) as { amount: number };
			const { balance } = await this.maybe_grant(now);
			const next = balance + amount;
			await this.state.storage.put('balance', next);
			return Response.json({ balance: next });
		}

		return new Response('bad', { status: 400 });
	}
}
