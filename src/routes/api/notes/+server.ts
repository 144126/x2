import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { put_file, MAX_FILE_BYTES } from '$lib/server/media';
import { get_secret } from '$lib/server/qdrant';
import { guard } from '$lib/server/rl';
import { ensure_device_session } from '$lib/server/device';
import { add_note, next_note, mark_heard, my_notes, delete_note } from '$lib/server/notes';
import { transcribe } from '$lib/server/transcribe';
import { get_user_name } from '$lib/server/user';
import { prompt_id } from '$lib/prompts';

/** the note you have not heard yet, plus who left it */
export const GET: RequestHandler = async ({ locals, url, platform, cookies, getClientAddress }) => {
	// a first-time visitor must hear a human before anything asks them to sign up
	const user = await ensure_device_session(env, platform, locals, cookies, getClientAddress);
	if (!user) throw error(401, 'auth');

	if (url.searchParams.get('mine')) return json({ r: await my_notes(env, user.id) });

	const note = await next_note(env, user.id);
	if (!note) return json({ n: null });
	await mark_heard(env, user.id, note.id);
	return json({ n: { ...note, name: await get_user_name(env, note.f) } });
};

export const POST: RequestHandler = async ({
	request,
	locals,
	platform,
	cookies,
	getClientAddress
}) => {
	const user = await ensure_device_session(env, platform, locals, cookies, getClientAddress);
	if (!user) throw error(401, 'auth');
	await guard(platform, 'RL_UPLOAD', user.id);

	const bucket = platform?.env?.MEDIA;
	if (!bucket) throw error(503, 'media_unconfigured');
	const secret = await get_secret(env.SECRET);
	if (!secret) throw error(503, 'no_secret');

	const form = await request.formData().catch(() => null);
	const audio = form?.get('audio');
	if (!(audio instanceof Blob)) throw error(400, 'audio required');
	if (audio.size > MAX_FILE_BYTES) throw error(413, 'too long');

	const saved = await put_file(bucket, user.id, audio, 'note', secret);
	if (!saved) throw error(415, 'unsupported audio format');

	const note = await add_note(env, user.id, saved.key, prompt_id());

	// the transcript is what makes this note matchable, but nobody should wait for it
	locals.bg(
		transcribe(env, audio).then(async (x) => {
			if (!x) return;
			const { set_transcript } = await import('$lib/server/notes');
			await set_transcript(env, note, x);
		})
	);

	return json({ n: note });
};

export const DELETE: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) throw error(401, 'auth');
	const id = url.searchParams.get('id');
	if (!id) throw error(400, 'id required');
	if (!(await delete_note(env, locals.user.id, id))) throw error(404, 'not yours');
	return json({ ok: true });
};
