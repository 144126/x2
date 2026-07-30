const url = process.env.QDRANT_URL.replace(/\/$/, '');
const key = process.env.QDRANT_KEY;
const prefix = (process.argv.find((a) => a.startsWith('--prefix=')) ?? '--prefix=probe_').slice(9);
const apply = process.argv.includes('--apply');

const q = (path, body) =>
	fetch(`${url}/collections/x2${path}`, {
		method: 'POST',
		headers: { 'api-key': key, 'content-type': 'application/json' },
		body: JSON.stringify(body)
	}).then(async (r) => {
		if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
		return r.json();
	});

let offset = null;
const doomed = [];
do {
	const { result } = await q('/points/scroll', {
		filter: { must: [{ key: 's', match: { value: 'u' } }] },
		limit: 100,
		...((offset ?? false) && { offset })
	});
	for (const pt of result.points) {
		if (typeof pt.payload?.u === 'string' && pt.payload.u.startsWith(prefix)) {
			doomed.push({ id: pt.id, username: pt.payload.u });
		}
	}
	offset = result.next_page_offset ?? null;
} while (offset);

if (!doomed.length) {
	console.log('no probe users found');
	process.exit(0);
}

console.log('found %d probe user(s):', doomed.length);
for (const d of doomed) console.log('  %s  (%s)', d.username, d.id);

if (!apply) {
	console.log('\ndry-run; pass --apply to delete');
	process.exit(0);
}

await q('/points/delete', { points: doomed.map((d) => d.id) });
console.log('deleted');
