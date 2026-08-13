const url = process.env.QDRANT_URL.replace(/\/$/, '');
const key = process.env.QDRANT_KEY;
const H = { 'api-key': key, 'content-type': 'application/json' };
// defaults to the live alias post named_vector_migration; pass the old collection name
// explicitly (`node latency-probe.mjs x2`) only while it still exists pre-cutover.
const collection = process.argv[2] ?? 'x2live';
const t = async (label, fn) => {
	const s = Date.now();
	const r = await fn();
	console.log(label.padEnd(34), `${Date.now() - s}ms`, r);
};

const info = await (await fetch(`${url}/collections/${collection}`, { headers: H })).json();
console.log('indexed keys:', Object.keys(info.result.payload_schema).sort().join(','));
console.log('points:', info.result.points_count);

await t('PUT index (no-op) x1', async () => {
	const r = await fetch(`${url}/collections/${collection}/index`, {
		method: 'PUT',
		headers: H,
		body: JSON.stringify({ field_name: 's', field_schema: 'keyword' })
	});
	return `${r.status}  -> ensure() does 20 of these`;
});

await t('scroll s=m limit1000', async () => {
	const r = await fetch(`${url}/collections/${collection}/points/scroll`, {
		method: 'POST',
		headers: H,
		body: JSON.stringify({
			filter: { must: [{ key: 's', match: { value: 'm' } }] },
			limit: 1000,
			with_payload: true,
			with_vector: false
		})
	});
	return `${r.status} n=${(await r.json()).result.points.length}`;
});

const ID = '00000000-0000-4000-8000-0000000000ff';
const ZV = new Array(4096).fill(0);
const P = { id: ID, vector: {}, payload: { s: 'zzz_latency_probe', d: Date.now() } };
const pts = (qs, body, method = 'PUT') =>
	fetch(`${url}/collections/${collection}/points${qs}`, {
		method,
		headers: H,
		body: JSON.stringify(body)
	});

await t('upsert wait=false', async () => (await pts('?wait=false', { points: [P] })).status);
await t('upsert wait=true', async () => (await pts('?wait=true', { points: [P] })).status);
await t(
	'update_vectors wait=false',
	async () =>
		(await pts('/vectors?wait=false', { points: [{ id: ID, vector: { t: ZV.map(() => 0.01) } }] }))
			.status
);
await t(
	'delete probe',
	async () => (await pts('/delete?wait=true', { points: [ID] }, 'POST')).status
);

const vk = process.env.VOXELL_KEY;
for (const s of ['hey', 'how are you doing today', 'ok']) {
	await t(`embed ${JSON.stringify(s.slice(0, 14))}`, async () => {
		const r = await fetch('https://api.voxell.ai/v1/embeddings', {
			method: 'POST',
			headers: { Authorization: `Bearer ${vk}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({ model: 'jcorners/ingot-8b-r3', input: s })
		});
		const j = await r.json().catch(() => null);
		return `${r.status} dim=${j?.data?.[0]?.embedding?.length ?? 'n/a'}`;
	});
}
