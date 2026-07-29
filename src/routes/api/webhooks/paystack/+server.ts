import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { verify_webhook_sig } from '$lib/server/paystack';
import { mark_paystack_ref_processed, record_event } from '$lib/server/credits';
import { credit } from '$lib/server/credit_client';
import { pay_referral_bonus } from '$lib/server/partner';

type ChargeSuccess = {
	event: string;
	data: { reference: string; amount: number; metadata?: { uid?: string } };
};

export const POST: RequestHandler = async ({ request, locals }) => {
	const sig = request.headers.get('x-paystack-signature');
	if (!sig) throw error(401, 'missing signature');

	const raw = await request.text();
	if (!(await verify_webhook_sig(env, raw, sig))) throw error(401, 'bad signature');

	let body: ChargeSuccess;
	try {
		body = JSON.parse(raw);
	} catch {
		throw error(400, 'invalid body');
	}

	if (body.event === 'charge.success') {
		const { reference, amount, metadata } = body.data;
		const uid = metadata?.uid;
		if (uid) {
			const first = await mark_paystack_ref_processed(env, reference);
			if (first) {
				const { balance } = await credit(locals.x2_ws, uid, amount);
				await record_event(env, {
					uid,
					kind: 'purchase',
					amount,
					balance_after: balance,
					ts: Date.now(),
					ref: reference
				});
				await pay_referral_bonus({ env, ws: locals.x2_ws }, amount, uid, reference);
			}
		}
	}

	return json({ received: true });
};
