import { retrieve_one, scroll, f, eq, type QEnv } from './qdrant';
import { credit } from './credit_client';
import { record_event } from './credits';
import { get_user, patch_user } from './user';
import type { User } from '../types';

const COMMISSION_RATE = 0.54; // 54% of the purchased credits, per spec

export type PartnerCtx = { env: QEnv; ws: Fetcher };

/** Pays the buyer's inviter 54% of a credit purchase, in credits — no bank transfer involved. */
export async function pay_referral_bonus(
	ctx: PartnerCtx,
	purchase_kobo: number,
	buyer_uid: string,
	purchase_ref: string
): Promise<void> {
	const buyer = (await retrieve_one(ctx.env, buyer_uid))?.payload as unknown as User | undefined;
	const inviter = buyer?.invited_by;
	if (!inviter || inviter === buyer_uid) return;

	const bonus = Math.round(purchase_kobo * COMMISSION_RATE);
	const { balance } = await credit(ctx.ws, inviter, bonus);
	await record_event(ctx.env, {
		uid: inviter,
		kind: 'referral_bonus',
		amount: bonus,
		balance_after: balance,
		ts: Date.now(),
		ref: purchase_ref
	});
}

/** compact, URL-safe, practically-unique — timestamp + random, base36 */
export function gen_partner_code(): string {
	const now = Date.now().toString(36);
	const rand = Math.floor(Math.random() * 46656)
		.toString(36)
		.padStart(3, '0');
	return (now + rand).toLowerCase();
}

async function code_taken(env: QEnv, code: string): Promise<boolean> {
	const hits = await scroll(env, f(eq('s', 'u'), eq('ac', code)), 1);
	return hits.length > 0;
}

/** assigns a partner code to a user if they don't already have one; otherwise a no-op */
export async function ensure_partner_code(env: QEnv, uid: string): Promise<string> {
	const u = await get_user(env, uid);
	if (u?.ac) return u.ac;

	let code = gen_partner_code();
	while (await code_taken(env, code)) code = gen_partner_code();

	await patch_user(env, uid, { ac: code });
	return code;
}

/** attributes a newly-created account to the partner whose code it signed up under */
export async function attribute_referral(
	env: QEnv,
	new_uid: string,
	code: string
): Promise<{ ok: boolean; inviter?: string }> {
	if (!code.trim()) return { ok: false };
	const hits = await scroll(env, f(eq('s', 'u'), eq('ac', code)), 1);
	const inviter = hits[0]?.id as string | undefined;
	if (!inviter || inviter === new_uid) return { ok: false };
	await patch_user(env, new_uid, { invited_by: inviter });
	return { ok: true, inviter };
}
