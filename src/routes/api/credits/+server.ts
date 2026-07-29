import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { get_balance } from '$lib/server/credit_client';
import { credit_history } from '$lib/server/credits';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) throw error(401, 'auth');
	const { balance, granted_today } = await get_balance(locals.x2_ws, locals.user.id).catch(
		() => ({ balance: 0, granted_today: false })
	);
	const history = await credit_history(env, locals.user.id, 20);
	return json({ balance, granted_today, history });
};
