// One-off migration: x2 (unnamed vector, every row carries a 16KB zero vector) -> x2v2 (named
// vector `t`, a row may carry none at all). See plan/scale.plan.json -> named_vector_migration
// for the full writeup and the live-cluster proof this design is based on.
//
// Usage:
//   node --env-file=.env scripts/migrate-named-vectors.mjs           dry run — verifies only
//   node --env-file=.env scripts/migrate-named-vectors.mjs --apply   creates x2v2 + copies data
//   node --env-file=.env scripts/migrate-named-vectors.mjs --alias   points alias x2live -> x2v2
//
// Deliberately three separate flags, not one big --apply: creating the collection+data is
// reversible (x2v2 can be dropped and redone); flipping the alias is the point of no return for
// anything that starts reading x2live, so it is a separate, explicit step run only after the
// point-count verification below has printed OK.
//
// This script NEVER touches the original `x2` collection. Deleting it is intentionally not
// automated — the plan requires a full verified read/write cycle on x2live (i.e. a deploy) first.

const url = process.env.QDRANT_URL.replace(/\/$/, '');
const H = { 'api-key': process.env.QDRANT_KEY, 'content-type': 'application/json' };
const SRC = 'x2';
const DST = 'x2v2';
const ALIAS = 'x2live';
const V = 't';

const apply = process.argv.includes('--apply');
const do_alias = process.argv.includes('--alias');

const call = async (method, path, body) => {
	const r = await fetch(`${url}${path}`, {
		method,
		headers: H,
		...(body ? { body: JSON.stringify(body) } : {})
	});
	const j = await r.json().catch(() => ({}));
	if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${JSON.stringify(j)}`);
	return j;
};

const KEYWORD_KEYS = [
	's',
	't',
	'r',
	'c',
	'f',
	'co',
	'st',
	'ci',
	'u',
	'ow',
	'mb',
	'gr',
	'uid',
	'ac',
	'tg',
	'k'
];
const INT_KEYS = ['ag', 'at', 'sent', 'd'];

if (do_alias) {
	const info = await call('GET', `/collections/${DST}`).catch(() => null);
	if (!info) throw new Error(`${DST} does not exist — run --apply first`);
	await call('POST', '/collections/aliases', {
		actions: [{ create_alias: { collection_name: DST, alias_name: ALIAS } }]
	});
	console.log(`alias ${ALIAS} -> ${DST} created`);
	process.exit(0);
}

console.log(`source: ${SRC}`);
const src_info = await call('GET', `/collections/${SRC}`);
const src_count = src_info.result.points_count;
console.log(`  points: ${src_count}`);

if (!apply) {
	const dst_info = await call('GET', `/collections/${DST}`).catch(() => null);
	console.log(
		dst_info
			? `${DST} already exists, points: ${dst_info.result.points_count}`
			: `${DST} does not exist yet`
	);
	console.log('\ndry run — pass --apply to create the collection and copy data');
	process.exit(0);
}

console.log(`\ncreating ${DST} with named vector "${V}"...`);
await call('PUT', `/collections/${DST}`, { vectors: { [V]: { size: 4096, distance: 'Cosine' } } });

console.log('creating payload indexes...');
for (const k of KEYWORD_KEYS) {
	await call('PUT', `/collections/${DST}/index?wait=true`, {
		field_name: k,
		field_schema: 'keyword'
	});
}
for (const k of INT_KEYS) {
	await call('PUT', `/collections/${DST}/index?wait=true`, {
		field_name: k,
		field_schema: 'integer'
	});
}
console.log(`  ${KEYWORD_KEYS.length + INT_KEYS.length} indexes created`);

console.log('\ncopying points...');
let offset = null;
let copied = 0;
let with_vec = 0;
do {
	const { result } = await call('POST', `/collections/${SRC}/points/scroll`, {
		limit: 200,
		offset,
		with_payload: true,
		with_vector: true
	});
	if (result.points.length) {
		const points = result.points.map((p) => {
			const has_real_vector = Array.isArray(p.vector) && p.vector.some((v) => v !== 0);
			if (has_real_vector) with_vec++;
			return {
				id: p.id,
				payload: p.payload,
				vector: has_real_vector ? { [V]: p.vector } : {}
			};
		});
		await call('PUT', `/collections/${DST}/points?wait=true`, { points });
		copied += points.length;
		process.stdout.write(`\r  copied ${copied}/${src_count}`);
	}
	offset = result.next_page_offset;
} while (offset);
console.log(`\n  done — ${copied} points copied, ${with_vec} carried a real vector`);

console.log('\nverifying point counts...');
const dst_info = await call('GET', `/collections/${DST}`);
const dst_count = dst_info.result.points_count;
console.log(`  ${SRC}: ${src_count}    ${DST}: ${dst_count}`);
if (dst_count !== src_count) {
	console.error(`  MISMATCH — do not create the alias or deploy. Investigate before proceeding.`);
	process.exit(1);
}
console.log('  OK — counts match.');
console.log(`\nNext: node --env-file=.env scripts/migrate-named-vectors.mjs --alias`);
console.log(
	`Then: set C = '${ALIAS}' in src/lib/server/qdrant.ts, deploy, verify, THEN drop ${SRC}.`
);
