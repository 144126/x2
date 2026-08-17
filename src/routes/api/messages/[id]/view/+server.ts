import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { get_message_raw, may_read } from '$lib/server/chat';
import { open_view_once } from '$lib/server/viewonce';
import { audience, relay_to } from '$lib/server/msg_relay';
import { guard } from '$lib/server/rl';
import { b64u } from '$lib/server/qdrant';

/**
 * Spend one view. This is the only route that can produce view-once content, and it hands
 * the bytes back in the same response rather than a link to them — so there is no URL to
 * paste, nothing for a cache or a service worker to keep, and no window between the view
 * being spent and the content being destroyed.
 *
 * POST, not GET, because it changes the world: calling it twice is the thing it exists to
 * prevent, and a GET is exactly what a prefetcher, a crawler, or a back button repeats.
 */
export const POST: RequestHandler = async ({ params, locals, platform }) => {
	if (!locals.user) throw error(401, 'auth');
	await guard(platform, 'RL_SEND', locals.user.id);

	const m = await get_message_raw(env, params.id);
	if (!m) throw error(404, 'not found');
	if (!(await may_read(env, locals.x2_ws, m, locals.user.id))) throw error(403, 'not a participant');

	const burnt = await open_view_once(env, platform?.env?.MEDIA, m, locals.user.id);

	locals.bg(
		audience(env, m, locals.user.id).then((t) =>
			relay_to(locals.x2_ws, t, {
				type: 'viewed',
				id: m.id,
				by: locals.user!.id,
				gone: burnt.gone
			})
		)
	);

	// text and stickers come back as json; anything with bytes comes back as the bytes, with
	// the caption riding in a header so one response still carries the whole message
	if (!burnt.body) {
		return json({
			kind: burnt.kind,
			text: burnt.text,
			sticker: burnt.sticker,
			gone: burnt.gone
		});
	}

	const h = new Headers({
		'content-type': burnt.type || 'application/octet-stream',
		'cache-control': 'no-store, private',
		'x-kind': burnt.kind,
		'x-gone': burnt.gone ? '1' : '0'
	});
	if (burnt.file) {
		h.set('x-name', b64u(new TextEncoder().encode(burnt.file.name)));
		h.set('x-size', String(burnt.file.size));
	}
	if (burnt.text) h.set('x-caption', b64u(new TextEncoder().encode(burnt.text)));
	return new Response(burnt.body, { headers: h });
};
