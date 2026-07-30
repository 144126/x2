const url = process.env.QDRANT_URL.replace(/\/$/, '');
const key = process.env.QDRANT_KEY;
const vkey = process.env.VOXELL_KEY;
const apply = process.argv.includes('--apply');
const limit = Number(process.argv.find((a) => a.startsWith('--limit='))?.slice(8) ?? 500);
const MODEL = 'jcorners/ingot-8b-r3';

const H = { 'api-key': key, 'content-type': 'application/json' };
const q = (path, body, method = 'POST') =>
	fetch(`${url}/collections/x2${path}`, { method, headers: H, body: JSON.stringify(body) }).then(
		async (r) => {
			if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
			return r.json();
		}
	);

const embed = async (text) => {
	const r = await fetch('https://api.voxell.ai/v1/embeddings', {
		method: 'POST',
		headers: { Authorization: `Bearer ${vkey}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({ model: MODEL, input: text.slice(0, 8000) })
	});
	if (!r.ok) throw new Error(`embed ${r.status} ${await r.text()}`);
	return (await r.json()).data[0].embedding;
};

let offset = null;
const stale = [];
do {
	const { result } = await q('/points/scroll', {
		filter: { must: [{ key: 's', match: { value: 'm' } }] },
		limit: 64,
		offset,
		with_payload: true,
		with_vector: true
	});
	for (const p of result.points) {
		const text = (p.payload.x ?? '').trim();
		if (text.length < 3) continue;
		if (Array.isArray(p.vector) && p.vector.some((v) => v !== 0)) continue;
		stale.push({ id: p.id, text });
	}
	offset = result.next_page_offset;
} while (offset && stale.length < limit);

console.log(`${stale.length} message(s) with a zero vector and >=3 chars of text`);
for (const { id, text } of stale) console.log(`  ${id}  ${JSON.stringify(text.slice(0, 60))}`);
if (!apply) {
	console.log('\ndry run — pass --apply to patch');
	process.exit(0);
}

let ok = 0;
for (const { id, text } of stale) {
	try {
		const vector = await embed(text);
		await q('/points/vectors?wait=true', { points: [{ id, vector }] }, 'PUT');
		ok++;
	} catch (e) {
		console.error(`  FAILED ${id}: ${e.message}`);
	}
}
console.log(`patched ${ok}/${stale.length}`);
