// Thin client for the ws worker's CreditAccount Durable Object (one instance per uid, atomic
// balance mutations by construction — see ws/src/credit_account.ts).

export type Balance = { balance: number; granted_today: boolean };
export type DeductResult =
	| { ok: true; balance: number }
	| { ok: false; reason: 'insufficient_credits'; balance: number };

async function call(ws: Fetcher, path: string, init?: RequestInit): Promise<Response> {
	return ws.fetch(`https://x2-ws${path}`, init);
}

export async function get_balance(ws: Fetcher, uid: string): Promise<Balance> {
	const res = await call(ws, `/credits/${uid}/balance`);
	return res.json();
}

export async function deduct(ws: Fetcher, uid: string, amount: number): Promise<DeductResult> {
	const res = await call(ws, `/credits/${uid}/deduct`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ amount })
	});
	return res.json();
}

export async function credit(ws: Fetcher, uid: string, amount: number): Promise<{ balance: number }> {
	const res = await call(ws, `/credits/${uid}/credit`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ amount })
	});
	return res.json();
}
