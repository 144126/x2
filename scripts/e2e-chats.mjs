#!/usr/bin/env node
// Two-account chats-pipeline e2e: boots the dev stack (pnpm dev:full), mints two
// anonymous device accounts, sends B -> A, then verifies A's /api/conversations and
// /app/chats render the thread, records the JSON shape, and cleans up after itself
// (deletes the two test messages via the authenticated delete route and the two
// throwaway user points straight from Qdrant).
//
// Usage:
//   node scripts/e2e-chats.mjs [--keep-dev] [--app=<origin>]
//
//   --keep-dev   leave the dev stack running when done
//   --app        override the app origin (default http://localhost:4173)
//
// Needs the same local secrets as pnpm dev:full: root .env (app) and ws/.env
// (ws worker), with SECRET == DEV_SECRET parity for hub auth.

import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url)) + '/..';
const APP =
	(process.argv.find((a) => a.startsWith('--app=')) ?? '').slice(6) || 'http://localhost:4173';
const KEEP_DEV = process.argv.includes('--keep-dev');
const DUMMY_UID = '00000000-0000-4000-8000-000000000000';

let dev = null;
let pass = 0;
const fail = (m) => {
	console.error(`[e2e] FAIL ${m}`);
	process.exitCode = 1;
};

function client() {
	const jar = new Map();
	return {
		async request(pathname, { method = 'GET', body } = {}) {
			const r = await fetch(APP + pathname, {
				method,
				headers: {
					...(body ? { 'content-type': 'application/json' } : {}),
					...(jar.size
						? { cookie: [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ') }
						: {})
				},
				body: body ? JSON.stringify(body) : undefined
			});
			const sc = r.headers.get('set-cookie');
			if (sc) {
				for (const part of sc.split(', ')) {
					const nv = part.split(';', 1)[0];
					const i = nv.indexOf('=');
					const name = nv.slice(0, i);
					const value = nv.slice(i + 1);
					if (name === 'session' && value === '') jar.delete(name);
					else jar.set(name, value);
				}
			}
			return r;
		}
	};
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function up() {
	try {
		return (await fetch(APP + '/')).ok;
	} catch {
		return false;
	}
}

async function waitUp() {
	for (let i = 0; i < 240; i++) {
		if (await up()) return;
		await sleep(1000);
	}
	throw new Error(`app never came up on ${APP}`);
}

async function startStack() {
	console.log('[e2e] starting pnpm dev:full ...');
	dev = spawn('pnpm', ['dev:full'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
	dev.stdout.on('data', (d) => process.stdout.write('[dev] ' + d));
	dev.stderr.on('data', (d) => process.stderr.write('[dev] ' + d));
	const exited = new Promise((_, rej) =>
		dev.on('exit', (c) => rej(new Error(`dev:full exited early (code ${c})`)))
	);
	await Promise.race([waitUp(), exited]);
	console.log('[e2e] dev stack up');
}

function parseEnv(txt) {
	const out = {};
	for (const line of txt.split('\n')) {
		const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
		if (m) out[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
	}
	return out;
}

async function purgeUsers(ids) {
	if (!ids.length) return;
	try {
		const env = parseEnv(await readFile(path.join(ROOT, '.env'), 'utf8'));
		const r = await fetch(`${env.QDRANT_URL.replace(/\/$/, '')}/collections/x2live/points/delete`, {
			method: 'POST',
			headers: { 'api-key': env.QDRANT_KEY, 'content-type': 'application/json' },
			body: JSON.stringify({ points: ids })
		});
		if (!r.ok) console.warn(`[e2e] user purge status ${r.status}`);
		else console.log(`[e2e] purged ${ids.length} throwaway user point(s)`);
	} catch (e) {
		console.warn('[e2e] user purge skipped:', e.message);
	}
}

async function main() {
	if (!(await up())) await startStack();

	const A = client();
	const B = client();

	const warm = await A.request('/api/send', {
		method: 'POST',
		body: { to: DUMMY_UID, text: 'e2e warmup' }
	});
	const uidA = (await warm.json()).m?.from;
	if (!uidA) return fail(`account A session not minted (${warm.status})`);

	const sent = await B.request('/api/send', {
		method: 'POST',
		body: { to: uidA, text: 'hi from B' }
	});
	const bMsg = (await sent.json()).m;
	const uidB = bMsg?.from;
	if (!uidB) return fail(`account B session not minted (${sent.status})`);
	console.log(`[e2e] A=${uidA}  B=${uidB}  msg=${bMsg.id}`);

	let convs = null;
	for (let i = 0; i < 20; i++) {
		const r = await A.request('/api/conversations');
		convs = await r.json();
		if (convs.r?.some((c) => c.peer === uidB)) break;
		await sleep(500);
	}
	const thread = convs.r?.find((c) => c.peer === uidB);
	if (!thread) {
		return fail(
			`A's /api/conversations never showed B's thread (got ${convs.r?.length ?? 'no r'})`
		);
	}
	if (thread.preview !== 'hi from B')
		return fail(`preview mismatch: ${JSON.stringify(thread.preview)}`);
	if (!thread.unread) return fail(`expected unread >= 1 on B's thread, got ${thread.unread}`);
	pass++;

	const chats = await A.request('/app/chats');
	const html = await chats.text();
	if (!html.includes('hi from B')) return fail('/app/chats SSR did not render the thread preview');
	pass++;

	console.log(`[e2e] PASS ${pass}/2 checks`);
	console.log('[e2e] recorded /api/conversations shape:');
	console.log(JSON.stringify(convs.r, null, 2));

	await A.request(`/api/messages/${(await warm.json()).m.id}/delete`, { method: 'POST' });
	await B.request(`/api/messages/${bMsg.id}/delete`, { method: 'POST' });
	await purgeUsers([uidA, uidB]);
}

main()
	.catch((e) => {
		console.error('[e2e] FAIL', e.message);
		process.exitCode = 1;
	})
	.finally(async () => {
		if (dev && !KEEP_DEV) {
			dev.kill('SIGTERM');
			await sleep(1000);
		}
	});
