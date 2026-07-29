import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { new_id } from '$lib/server/qdrant';
import { paystack_init } from '$lib/server/paystack';

const MIN_KOBO = 10_000; // ₦100, matches Paystack's practical minimum charge

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) throw error(401, 'auth');
	const b = (await request.json().catch(() => null)) as { amount_kobo?: number } | null;
	const amount_kobo = b?.amount_kobo;
	if (!amount_kobo || amount_kobo < MIN_KOBO) throw error(400, `amount_kobo must be at least ${MIN_KOBO}`);

	const email = locals.user.email || `${locals.user.id}@x2.studio`;
	const reference = new_id();
	const callback_url = `${new URL(request.url).origin}/app/profile`;

	try {
		const result = await paystack_init(env, email, amount_kobo, reference, callback_url, {
			uid: locals.user.id
		});
		return json(result);
	} catch {
		throw error(502, 'payment provider unavailable');
	}
};
