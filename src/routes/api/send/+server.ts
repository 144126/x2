import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { send_msg } from '$lib/server/chat';


export const POST: RequestHandler = async ({ request, locals, platform }) => {
	if (!locals.user) throw error(401, 'auth');
	const b = (await request.json().catch(() => null)) as { to?: string; text?: string };
	const to = b?.to?.trim();
	const text = (b?.text ?? '').trim();
	if (!to || !text) throw error(400, 'to + text required');
	const m = await send_msg(env, locals.user.id, to, text);
	// relay to ws worker for live delivery (best-effort)
	const ws = platform?.env?.X2_WS as Fetcher | undefined;
	if (ws) {
		await ws
			.fetch('https://x2-ws/relay', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					to,
					from: locals.user.id,
					from_name: locals.user.name,
					text,
					ts: m.d
				})
			})
			.catch(() => {});
	}
	return json({ ok: true, m: { id: m.id, from: m.f, to: m.t, text: m.x, ts: m.d } });
};
