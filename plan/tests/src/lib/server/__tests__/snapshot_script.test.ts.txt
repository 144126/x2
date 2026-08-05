import { describe, it, expect } from 'vitest';
import { snapshot_api, snapshot_key } from '../../../../scripts/snapshot-qdrant.mjs';

const BASE = 'https://cluster.qdrant.io:6333';
const API = snapshot_api(BASE, 'x2live', 'secret-key');

describe('snapshot url and key construction', () => {
	it('creates against the collection snapshots endpoint', () => {
		expect(API.create.url).toBe(`${BASE}/collections/x2live/snapshots`);
		expect(API.create.method).toBe('POST');
	});

	it('authenticates with the api-key header, never a query param', () => {
		expect(API.create.headers['api-key']).toBe('secret-key');
		expect(API.create.url).not.toContain('secret-key');
	});

	it('downloads the named snapshot', () => {
		expect(API.download('snap-1.snapshot').url).toBe(
			`${BASE}/collections/x2live/snapshots/snap-1.snapshot`
		);
	});

	it('deletes the named snapshot so the cluster disk does not fill', () => {
		const d = API.remove('snap-1.snapshot');
		expect(d.url).toBe(`${BASE}/collections/x2live/snapshots/snap-1.snapshot`);
		expect(d.method).toBe('DELETE');
	});

	it('tolerates a base url with a trailing slash', () => {
		const a = snapshot_api(BASE + '/', 'x2live', 'k');
		expect(a.create.url).toBe(`${BASE}/collections/x2live/snapshots`);
	});

	it('names the r2 object by collection and utc date', () => {
		expect(snapshot_key('x2live', new Date('2026-08-05T23:59:59Z'))).toBe(
			'qdrant/x2live/2026-08-05.snapshot'
		);
	});

	it('uses utc, so a late-evening run does not land on the wrong day', () => {
		expect(snapshot_key('x2live', new Date('2026-08-05T00:00:00Z'))).toBe(
			'qdrant/x2live/2026-08-05.snapshot'
		);
	});

	it('one run per day overwrites rather than accumulating', () => {
		const a = snapshot_key('x2live', new Date('2026-08-05T01:00:00Z'));
		const b = snapshot_key('x2live', new Date('2026-08-05T22:00:00Z'));
		expect(a).toBe(b);
	});
});
