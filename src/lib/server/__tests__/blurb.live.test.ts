// Live check against the real Groq endpoint. Skipped unless GROQ is set, so it never
// runs in CI or offline — but it is the only test that can catch the failure that
// mocking hides: gpt-oss is a reasoning model, and with too small a token budget it
// spends the whole budget thinking and returns an empty string.
//
// Opt in explicitly — vitest already loads .env, so keying this on GROQ alone would put a
// network call that can rate-limit into every plain `pnpm test`.
//
// Run it with:  LIVE_GROQ=1 pnpm vitest run blurb.live
import { describe, it, expect, vi } from 'vitest';

const KEY = process.env.LIVE_GROQ ? process.env.GROQ : '';

vi.mock('../qdrant', async () => {
	const actual = await vi.importActual<typeof import('../qdrant')>('../qdrant');
	return {
		...actual,
		ensure: async () => {},
		retrieve_one: async () => null,
		upsert: async () => {}
	};
});

import { match_blurb } from '../blurb';
import type { User } from '../../types';

describe.skipIf(!KEY)('match_blurb against the real model', () => {
	it('returns one short line, not an empty string', async () => {
		const line = await match_blurb(
			{ GROQ: KEY, QDRANT_URL: 'u', QDRANT_KEY: 'k' },
			`live|${Date.now()}`,
			{ s: 'u', u: 'a', a: 'i build modular synths at night', i: ['modular', 'jazz'] } as User,
			{ s: 'u', u: 'b', a: 'i restore old tape machines', i: ['analog', 'dub'] } as User
		);
		console.log('[blurb.live] ->', JSON.stringify(line));
		expect(line.length).toBeGreaterThan(0);
		expect(line.split(/\s+/).length).toBeLessThanOrEqual(20);
		expect(line).not.toContain('\n');
	}, 30_000);
});
