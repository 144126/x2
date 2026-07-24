import { get_secret, ZV, type QEnv } from './qdrant';

const EMBED_MODEL = 'jcorners/ingot-8b-r3';

export async function embed(env: QEnv, text: string): Promise<number[]> {
	const key = await get_secret(env.VOXELL_KEY);
	if (!key || !text.trim()) return ZV;
	try {
		const r = await fetch('https://api.voxell.ai/v1/embeddings', {
			method: 'POST',
			headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({ model: EMBED_MODEL, input: text.slice(0, 8000) })
		});
		if (!r.ok) return ZV;
		const j = (await r.json()) as { data: { embedding: number[] }[] };
		return j.data[0].embedding;
	} catch {
		return ZV;
	}
}
