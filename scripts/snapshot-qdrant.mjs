#!/usr/bin/env node
// Daily Qdrant snapshot -> R2 backup. Snapshot is created on the Qdrant cluster, downloaded,
// uploaded to R2 under qdrant/<collection>/<utc-date>.snapshot, then the cluster-side snapshot
// is deleted so the cluster disk does not fill. R2 access is S3-compatible SigV4 (no deps),
// credentials from R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET.
//
// Usage:
//   node scripts/snapshot-qdrant.mjs [options]
// Options (each also accepted as env var):
//   --url=<QDRANT_URL>       Qdrant base URL                     (required; env QDRANT_URL)
//   --key=<QDRANT_KEY>       Qdrant api key                      (required; env QDRANT_KEY)
//   --collection=<name>      Qdrant collection                   (default x2live)
//   --account-id=<id>        R2 account id (host in endpoint)    (env R2_ACCOUNT_ID)
//   --access-key=<id>        R2 S3 access key id                 (env R2_ACCESS_KEY_ID)
//   --secret-key=<key>       R2 S3 secret access key             (env R2_SECRET_ACCESS_KEY)
//   --bucket=<name>          R2 bucket                           (default x2-media; env R2_BUCKET)
//   --dry-run                print what would be done, write/delete nothing

/** @type {Record<string, string | boolean>} */
const opt = {};
for (const a of process.argv.slice(2)) {
	const eq = a.indexOf('=');
	if (a.startsWith('--') && eq > 0) opt[a.slice(2, eq)] = a.slice(eq + 1);
	else opt[a.slice(2)] = true;
}
/** @param {string} k @param {string} envK @returns {string|undefined} */
const get = (k, envK) => {
	const v = opt[k];
	return typeof v === 'string' ? v : process.env[envK];
};

const QURL = get('url', 'QDRANT_URL');
const QKEY = get('key', 'QDRANT_KEY');
const COLLECTION = get('collection', 'QDRANT_COLLECTION') ?? 'x2live';
const R2_ACCOUNT_ID = get('account-id', 'R2_ACCOUNT_ID');
const R2_ACCESS = get('access-key', 'R2_ACCESS_KEY_ID');
const R2_SECRET = get('secret-key', 'R2_SECRET_ACCESS_KEY');
const R2_BUCKET = get('bucket', 'R2_BUCKET') ?? 'x2-media';
const DRY = !!opt['dry-run'];

/**
 * @param {string} base
 * @param {string} collection
 * @param {string} apiKey
 */
export function snapshot_api(base, collection, apiKey) {
	const clean = base.replace(/\/+$/, '');
	const collection_endpoint = `${clean}/collections/${collection}/snapshots`;
	return {
		create: {
			url: collection_endpoint,
			method: 'POST',
			headers: { 'api-key': apiKey }
		},
		/** @param {string} name */
		download: (name) => ({
			url: `${collection_endpoint}/${name}`,
			method: 'GET',
			headers: { 'api-key': apiKey }
		}),
		/** @param {string} name */
		remove: (name) => ({
			url: `${collection_endpoint}/${name}`,
			method: 'DELETE',
			headers: { 'api-key': apiKey }
		})
	};
}

/**
 * @param {string} collection
 * @param {Date} date
 */
export function snapshot_key(collection, date) {
	return `qdrant/${collection}/${date.toISOString().slice(0, 10)}.snapshot`;
}

// ---- S3 SigV4, minimal, only what PUT of one object needs (lazy-imported: this module is
// imported by the worker cron route too, where node:crypto does not exist) ----
/**
 * @param {Record<string, string>} headers
 * @param {string} access
 * @param {string} secret
 * @param {string} region
 * @param {string} acc
 * @param {string} bucket
 * @param {string} key
 * @param {ArrayBuffer} body
 */
async function sigv4(headers, access, secret, region, acc, bucket, key, body) {
	const { createHmac, createHash } = await import('node:crypto');
	/** @param {string|Uint8Array} k @param {string|Uint8Array} d */
	const hmacFn = (k, d) => createHmac('sha256', k).update(d).digest();
	/** @param {string|Uint8Array} d */
	const sha256Fn = (d) => createHash('sha256').update(d).digest('hex');
	const body_bytes = new Uint8Array(body);
	const now = new Date();
	const amz_date = now.toISOString().replace(/[:\-]|\.\d{3}/g, '');
	const date_stamp = amz_date.slice(0, 8);
	const host = `${acc}.r2.cloudflarestorage.com`;
	const canonical_uri = `/${bucket}/${key}`;
	const payload_hash = sha256Fn(body_bytes);
	const canonical_headers = `host:${host}\nx-amz-content-sha256:${payload_hash}\nx-amz-date:${amz_date}\n`;
	const signed_headers = 'host;x-amz-content-sha256;x-amz-date';
	const canonical_request = [
		'PUT',
		canonical_uri,
		'',
		canonical_headers,
		signed_headers,
		payload_hash
	].join('\n');
	const scope = `${date_stamp}/${region}/s3/aws4_request`;
	const string_to_sign = ['AWS4-HMAC-SHA256', amz_date, scope, sha256Fn(canonical_request)].join(
		'\n'
	);
	let k = hmacFn(`AWS4${secret}`, date_stamp);
	k = hmacFn(k, region);
	k = hmacFn(k, 's3');
	k = hmacFn(k, 'aws4_request');
	const signature = hmacFn(k, string_to_sign).toString('hex');
	headers.host = host;
	headers['x-amz-date'] = amz_date;
	headers['x-amz-content-sha256'] = payload_hash;
	headers.Authorization = `AWS4-HMAC-SHA256 Credential=${access}/${scope}, SignedHeaders=${signed_headers}, Signature=${signature}`;
}

/**
 * @param {string} key
 * @param {ArrayBuffer} body
 */
async function r2_put(key, body) {
	if (DRY) {
		console.log(`  would-upload r2://${R2_BUCKET}/${key}`);
		return;
	}
	if (!R2_ACCOUNT_ID || !R2_ACCESS || !R2_SECRET) {
		throw new Error('missing R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY for upload');
	}
	/** @type {Record<string, string>} */
	const headers = {};
	await sigv4(headers, R2_ACCESS, R2_SECRET, 'auto', R2_ACCOUNT_ID, R2_BUCKET, key, body);
	const r = await fetch(`https://${headers.host}/${R2_BUCKET}/${key}`, {
		method: 'PUT',
		headers: {
			'x-amz-date': headers['x-amz-date'],
			'x-amz-content-sha256': headers['x-amz-content-sha256'],
			Authorization: headers.Authorization
		},
		body
	});
	if (!r.ok) throw new Error(`r2 put failed ${r.status}: ${await r.text()}`);
	console.log(`  uploaded r2://${R2_BUCKET}/${key}`);
}

const is_main = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (is_main) {
	(async () => {
		if (!QURL || !QKEY) {
			console.error('missing --url/--key (QDRANT_URL/QDRANT_KEY required)');
			process.exit(1);
		}
		const api = snapshot_api(QURL, COLLECTION, QKEY);
		console.log(`snapshot: collection=${COLLECTION} dryRun=${DRY}`);
		if (DRY) {
			console.log(`  would-create ${api.create.url}`);
			console.log(`  would-download ${api.download('<name>').url}`);
			console.log(`  would-upload r2://${R2_BUCKET}/qdrant/${COLLECTION}/<date>.snapshot`);
			console.log('  would-delete cluster snapshot');
			return;
		}
		const c = await fetch(api.create.url, { method: 'POST', headers: api.create.headers });
		if (!c.ok) throw new Error(`create failed ${c.status}: ${await c.text()}`);
		const name = (await c.json()).result?.name;
		if (!name) throw new Error('create returned no snapshot name');
		console.log(`  created ${name}`);
		const d = await fetch(api.download(name).url, { headers: api.download(name).headers });
		if (!d.ok) throw new Error(`download failed ${d.status}: ${await d.text()}`);
		const body = await d.arrayBuffer();
		await r2_put(snapshot_key(COLLECTION, new Date()), body);
		const r = await fetch(api.remove(name).url, {
			method: 'DELETE',
			headers: api.remove(name).headers
		});
		if (!r.ok) console.warn(`  delete snapshot failed ${r.status}: ${await r.text()}`);
		else console.log(`  deleted cluster snapshot ${name}`);
		console.log(`done: bytes=${body.byteLength}`);
	})().catch((e) => {
		console.error(e);
		process.exit(1);
	});
}
