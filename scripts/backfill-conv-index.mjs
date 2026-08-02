#!/usr/bin/env node
// Rebuild (or backfill) the per-user ChatHub conversation index from Qdrant — the source
// of truth. The conv index is a DERIVED CACHE (see plan/scale.plan.json -> hub_conv_index):
// it is only written at send time, at relay time, or by this script. Any conversation that
// exists in Qdrant but has no conv:<conv_id> entry in a participant's ChatHub DO shows up as
// "no conversations yet" on /app/chats — this script makes those conversations reappear.
//
// It handles legacy s:'x' match records AND s:'m' messages (1:1 and group), choosing the
// latest message per conversation per participant, and POSTs idempotently to /hub/{uid}/conv
// on the ws worker (an overwrite-by-key, so re-runs are safe).
//
// Usage:
//   node scripts/backfill-conv-index.mjs [options]
//
// Options (each also accepted as env var):
//   --url=<QDRANT_URL>    Qdrant base URL            (required; env QDRANT_URL)
//   --key=<QDRANT_KEY>    Qdrant api key             (required; env QDRANT_KEY)
//   --ws=<origin>         ws worker origin           (default http://localhost:8787; env WS_ORIGIN)
//   --secret=<value>      app SECRET Bearer auth on /hub/* (prod REQUIRED; env WS_SECRET)
//   --enc-key=<value>     MESSAGE_ENC_KEY to decrypt 'enc:' previews (optional; env MESSAGE_ENC_KEY)
//   --collection=<name>   Qdrant collection          (default x2live)
//   --uid=<target-id>     restrict to a single participant
//   --since=<epoch-ms>    only messages at/after this ts
//   --dry-run             print what would be written, write nothing

const opt = {};
for (const a of process.argv.slice(2)) {
	const eq = a.indexOf('=');
	if (a.startsWith('--') && eq > 0) opt[a.slice(2, eq)] = a.slice(eq + 1);
	else opt[a.slice(2)] = true;
}
const get = (k, envK) => opt[k] ?? process.env[envK];

const QURL = get('url', 'QDRANT_URL');
const QKEY = get('key', 'QDRANT_KEY');
const WS = get('ws', 'WS_ORIGIN') ?? 'http://localhost:8787';
const SECRET = get('secret', 'WS_SECRET');
const ENC_KEY = get('enc-key', 'MESSAGE_ENC_KEY');
const COLLECTION = get('collection', 'QDRANT_COLLECTION') ?? 'x2live';
const ONLY_UID = opt.uid;
const SINCE = opt.since ? Number(opt.since) : 0;
const DRY = !!opt['dry-run'];

if (!QURL || !QKEY) {
	console.error('missing --url or --key (QDRANT_URL/QDRANT_KEY required)');
	process.exit(1);
}

const j = (body) => ({
	method: 'POST',
	headers: { 'content-type': 'application/json', 'api-key': QKEY },
	body: JSON.stringify(body)
});

async function scroll(filter) {
	const pts = [];
	for (let offset = null; ; ) {
		const body = { filter, limit: 1000, with_payload: true };
		if (offset) body.offset = offset;
		const r = await fetch(`${QURL}/collections/${COLLECTION}/points/scroll`, j(body));
		if (!r.ok) throw new Error(`scroll failed ${r.status}: ${await r.text()}`);
		const b = await r.json();
		pts.push(...b.result.points);
		offset = b.result.next_page_offset;
		if (!offset) break;
	}
	return pts;
}

// AES-GCM decrypt of 'enc:' message text (mirrors src/lib/server/msg_crypto.ts).
// Legacy plaintext messages (no 'enc:' prefix) are returned as-is.
let gcm_key = null;
async function decrypt(stored) {
	if (!stored || !stored.startsWith('enc:')) return stored ?? '';
	if (!ENC_KEY || !globalThis.crypto?.subtle) return '';
	try {
		if (!gcm_key) {
			const bytes = Uint8Array.from(atob(ENC_KEY), (c) => c.charCodeAt(0));
			gcm_key = await crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['decrypt']);
		}
		const combined = Uint8Array.from(atob(stored.slice(4)), (c) => c.charCodeAt(0));
		const buf = await crypto.subtle.decrypt(
			{ name: 'AES-GCM', iv: combined.slice(0, 12) },
			gcm_key,
			combined.slice(12)
		);
		return new TextDecoder().decode(buf);
	} catch {
		return '';
	}
}

async function preview(p) {
	if (p.x) {
		const t = (await decrypt(p.x)).trim();
		if (t) return t.length > 100 ? t.slice(0, 100) + '…' : t;
	}
	if (p.fl) return '📎 file';
	if (p.im) return '📷 image';
	if (p.sk) return 'sticker';
	return 'message';
}

const memberCache = new Map();

async function participants(q) {
	if (q.gr) {
		let mb = memberCache.get(q.gr);
		if (mb === undefined) {
			try {
				const r = await fetch(
					`${QURL}/collections/${COLLECTION}/points/retrieve`,
					j({ ids: [q.gr], with_payload: true })
				);
				if (!r.ok) throw new Error('retrieve not ok');
				const hit = (await r.json()).result?.[0]?.payload;
				mb = hit?.s === 'g' ? (hit.mb ?? []) : [];
			} catch {
				// group record gone from Qdrant — index the sender's own hub only
				mb = [];
			}
			memberCache.set(q.gr, mb);
		}
		return [...new Set([q.f, ...mb])].filter(Boolean);
	}
	return [q.f, q.t].filter(Boolean);
}

// collect: key = `${uid}\0${conv}` -> latest entry per participant per conversation
const all = new Map();
let msgSeen = 0;

async function collect(q, kind, uid, entry) {
	if (ONLY_UID && uid !== ONLY_UID) return;
	const k = `${uid}\u0000${entry.conv}`;
	const cur = all.get(k);
	if (!cur || entry.last > cur.last) all.set(k, { uid, ...entry });
	void q;
	void kind;
}

async function main() {
	console.log(
		`rebuild conv index: collection=${COLLECTION} ws=${WS} dryRun=${DRY}` +
			(ONLY_UID ? ` uid=${ONLY_UID.slice(0, 8)}…` : '')
	);
	for (const s of ['x', 'm']) {
		const pts = await scroll({ must: [{ key: 's', match: { value: s } }] });
		if (s === 'x') {
			for (const pt of pts) {
				const q = pt.payload;
				const conv = [q.f, q.t].filter(Boolean).sort().join('|');
				if (!conv) continue;
				for (const uid of new Set([q.f, q.t])) {
					await collect(q, s, uid, {
						conv,
						peer: uid === q.f ? q.t : q.f,
						last: q.d,
						preview: 'you matched — say hi!'
					});
				}
			}
			continue;
		}
		for (const pt of pts) {
			const q = pt.payload;
			if (q.d < SINCE) continue;
			msgSeen++;
			const isG = !!q.gr;
			const conv = isG ? `g:${q.gr}` : [q.f, q.t].filter(Boolean).sort().join('|');
			if (!conv) continue;
			const base = { conv, last: q.d, preview: await preview(q) };
			for (const uid of await participants(q)) {
				const entry = isG ? { ...base, group: q.gr } : { ...base, peer: uid === q.f ? q.t : q.f };
				await collect(q, s, uid, entry);
			}
		}
	}

	const byUid = new Map();
	for (const e of all.values()) {
		const list = byUid.get(e.uid) ?? [];
		list.push({ conv: e.conv, peer: e.peer, group: e.group, last: e.last, preview: e.preview });
		byUid.set(e.uid, list);
	}

	let written = 0;
	let failed = 0;
	for (const [uid, entries] of byUid) {
		entries.sort((a, b) => b.last - a.last);
		console.log(`\nuid ${uid.slice(0, 8)}… entries=${entries.length}`);
		for (const e of entries) {
			const label = `  ${e.peer ? 'peer=' + e.peer.slice(0, 8) : 'group=' + e.group} last=${e.last} preview=${JSON.stringify(e.preview)}`;
			if (DRY) {
				console.log('  would-write' + label);
				continue;
			}
			const res = await fetch(`${WS}/hub/${encodeURIComponent(uid)}/conv`, {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					...(SECRET ? { authorization: `Bearer ${SECRET}` } : {})
				},
				body: JSON.stringify({
					conv: e.conv,
					...(e.peer ? { peer: e.peer } : { group: e.group }),
					last: e.last,
					preview: e.preview
				})
			});
			if (res.ok) {
				written++;
				console.log('  OK    ' + label);
			} else {
				failed++;
				console.log(`  FAIL  ${res.status} ` + label);
			}
		}
	}

	// verify: re-read every updated uid's index and check the entries are visible
	let checked = 0;
	let missing = 0;
	if (!DRY) {
		for (const [uid, entries] of byUid) {
			const res = await fetch(`${WS}/hub/${encodeURIComponent(uid)}/convs`, {
				headers: SECRET ? { authorization: `Bearer ${SECRET}` } : {}
			});
			if (!res.ok) continue;
			const have = new Set(((await res.json()).convs ?? []).map((c) => c.peer ?? c.group ?? ''));
			for (const e of entries) {
				checked++;
				if (!have.has(e.peer ?? e.group)) missing++;
			}
		}
	}
	if (DRY) {
		console.log(
			`\ndry-run complete: messages scanned=${msgSeen} would-write=${all.size} entries across ${byUid.size} uids`
		);
	} else {
		console.log(`\ndone: written=${written} failed=${failed} verify checked=${checked} still-missing=${missing}`);
	}
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
