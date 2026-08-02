import { deduct, credit } from './credit_client';
import { modal_complete } from './modal';
import type { QEnv } from './qdrant';
import type { User } from '../types';

const ESTIMATE_KOBO = 500; // flat, small — one short sentence, no per-token pricing available for this provider

function profile_summary(u: User): string {
	return [u.a, u.i?.join(', '), u.ag, u.co, u.st, u.ci].filter(Boolean).join(' | ');
}

export async function whats_in_common(
	env: QEnv,
	ws: Fetcher,
	viewer_uid: string,
	a: User,
	b: User
): Promise<
	| { ok: true; text: string }
	| { ok: false; reason: 'insufficient_credits' | 'llm_error' }
> {
	const gate = await deduct(ws, viewer_uid, ESTIMATE_KOBO);
	if (!gate.ok) return { ok: false, reason: gate.reason === 'service_unavailable' ? 'llm_error' : 'insufficient_credits' };

	try {
		const text = await modal_complete(env, [
			{
				role: 'user',
				content: `In one short friendly sentence, what do these two people have in common?\nPerson A: ${profile_summary(a)}\nPerson B: ${profile_summary(b)}`
			}
		]);
		return { ok: true, text };
	} catch {
		await credit(ws, viewer_uid, ESTIMATE_KOBO);
		return { ok: false, reason: 'llm_error' };
	}
}
