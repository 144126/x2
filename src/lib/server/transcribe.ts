import { get_secret, type QEnv, type SecretVal } from './qdrant';

const GROQ_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
export const WHISPER_MODEL = 'whisper-large-v3-turbo';

/**
 * Speech to text for a voice note.
 *
 * The transcript is worth far more than captions: it is the profile nobody was ever
 * going to fill in by typing. Thirty seconds of someone answering a real question says
 * more about them than a form they abandoned, and it is what the matcher can rank.
 *
 * Never throws. A note with no transcript is still a note.
 */
export async function transcribe(
	env: QEnv & { GROQ?: SecretVal },
	audio: Blob,
	filename = 'note.webm'
): Promise<string> {
	const key = await get_secret(env.GROQ);
	if (!key) return '';
	try {
		const form = new FormData();
		form.append('file', audio, filename);
		form.append('model', WHISPER_MODEL);
		form.append('response_format', 'text');
		const r = await fetch(GROQ_URL, {
			method: 'POST',
			headers: { Authorization: `Bearer ${key}` },
			body: form
		});
		if (!r.ok) return '';
		return (await r.text()).trim().slice(0, 2000);
	} catch {
		return '';
	}
}
