import { ensure, upsert, scroll, retrieve_one, new_id, uuid_from, f, eq, type QEnv } from './qdrant';

export type CreditEvent = {
	s: 'ce';
	id: string;
	uid: string;
	kind: 'daily_grant' | 'purchase' | 'deduct' | 'referral_bonus';
	amount: number; // signed: negative for deduct
	balance_after: number;
	ts: number;
	ref?: string;
};

export async function record_event(env: QEnv, e: Omit<CreditEvent, 's' | 'id'>): Promise<void> {
	await ensure(env);
	const ev: CreditEvent = { s: 'ce', id: new_id(), ...e };
	await upsert(env, [{ id: ev.id, vector: new Array(4096).fill(0), payload: ev as unknown as Record<string, unknown> }]);
}

export async function credit_history(env: QEnv, uid: string, limit = 100): Promise<CreditEvent[]> {
	await ensure(env);
	const pts = await scroll(env, f(eq('s', 'ce'), eq('uid', uid)), limit);
	return pts.map((p) => p.payload as unknown as CreditEvent).sort((a, b) => b.ts - a.ts);
}

/** true the first time a Paystack reference is seen — guards against webhook/callback double-credit */
export async function mark_paystack_ref_processed(env: QEnv, ref: string): Promise<boolean> {
	await ensure(env);
	const id = await uuid_from(`paystack:${ref}`);
	const existing = await retrieve_one(env, id);
	if (existing) return false;
	await upsert(env, [{ id, vector: new Array(4096).fill(0), payload: { s: 'pr', ref } }]);
	return true;
}
