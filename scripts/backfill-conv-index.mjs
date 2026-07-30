// Backfill conversation index for old s:'x' match records.
// Run ONCE against production before deploying the code that deletes list_conversations.
//
// Usage:
//   node scripts/backfill-conv-index.mjs <qdrant-url> <qdrant-key>
//
// It scrolls every s:'x' point and writes a conv:<conv_id> entry into both
// participants' ChatHub Durable Objects via the ws worker's /hub/:uid/conv route.

const [QDRANT_URL, QDRANT_KEY] = process.argv.slice(2);
if (!QDRANT_URL || !QDRANT_KEY) {
	console.error('Usage: node scripts/backfill-conv-index.mjs <qdrant-url> <qdrant-key>');
	process.exit(1);
}

async function main() {
	let offset = null;
	let count = 0;
	while (true) {
		const params = new URLSearchParams({ limit: '100', with_payload: 'true' });
		if (offset) params.set('offset', offset);
		params.set('filter', JSON.stringify({ must: [{ key: 's', match: { value: 'x' } }] }));
		const r = await fetch(`${QDRANT_URL}/collections/i/points/scroll?${params}`, {
			headers: { 'api-key': QDRANT_KEY }
		});
		if (!r.ok) {
			console.error('scroll failed:', r.status, await r.text());
			process.exit(1);
		}
		const body = await r.json();
		const pts = body.result.points;
		if (!pts.length) break;
		for (const pt of pts) {
			const p = pt.payload;
			const f = p.f;
			const t = p.t;
			const conv = [f, t].sort().join('|');
			const data = { conv, peer: t === f ? t : f, last: p.d, preview: 'you matched — say hi!' };
			console.log(`match ${pt.id}: ${f} <-> ${t} conv=${conv}`);
			// write to both participants' hubs — the ws worker must be reachable
			for (const uid of [f, t]) {
				const wsUrl = process.env.WS_ORIGIN || 'http://ws:8787';
				const res = await fetch(`${wsUrl}/hub/${uid}/conv`, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify(data)
				});
				if (!res.ok) console.warn(`  -> ${uid}: ${res.status}`);
			}
			count++;
		}
		offset = body.result.next_page_offset;
		if (!offset) break;
	}
	console.log(`done: ${count} match records backfilled`);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
