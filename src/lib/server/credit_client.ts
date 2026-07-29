// Thin client for the ws worker's CreditAccount Durable Object (one instance per uid, atomic
// balance mutations by construction — see ws/src/credit_account.ts).

export type Balance = { balance: number; granted_today: boolean };
export type DeductResult =
	| { ok: true; balance: number }
	| { ok: false; reason: 'insufficient_credits'; balance: number }
	| { ok: false; reason: 'service_unavailable'; balance: number };

async function call(ws: Fetcher, path: string, init?: RequestInit): Promise<Response> {
	return ws.fetch(`https://x2-ws${path}`, init);
}

async function safe_json<T>(res: Response, fallback: T): Promise<T> {
	if (!res.ok) return fallback;
	try {
		return (await res.json()) as T;
	} catch {
		return fallback;
	}
}

export async function get_balance(ws: Fetcher, uid: string): Promise<Balance> {
	try {
		const res = await call(ws, `/credits/${uid}/balance`);
		return await safe_json(res, { balance: 0, granted_today: false });
	} catch {
		return { balance: 0, granted_today: false };
	}
}

export async function deduct(ws: Fetcher, uid: string, amount: number): Promise<DeductResult> {
	try {
		const res = await call(ws, `/credits/${uid}/deduct`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ amount })
		});
		return await safe_json(res, { ok: false, reason: 'service_unavailable', balance: 0 });
	} catch {
		return { ok: false, reason: 'service_unavailable', balance: 0 };
	}
}

export async function credit(
	ws: Fetcher,
	uid: string,
	amount: number
): Promise<{ balance: number }> {
	try {
		const res = await call(ws, `/credits/${uid}/credit`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ amount })
		});
		return await safe_json(res, { balance: 0 });
	} catch {
		return { balance: 0 };
	}
}
