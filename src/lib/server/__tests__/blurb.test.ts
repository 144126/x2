import { describe, it, expect, vi, beforeEach } from 'vitest';

const { generateTextMock, retrieveOneMock, upsertMock, ensureMock } = vi.hoisted(() => ({
	generateTextMock: vi.fn(),
	retrieveOneMock: vi.fn(),
	upsertMock: vi.fn(),
	ensureMock: vi.fn()
}));

vi.mock('ai', () => ({ generateText: generateTextMock }));
vi.mock('@ai-sdk/openai-compatible', () => ({
	createOpenAICompatible: () => (id: string) => ({ id })
}));
vi.mock('../qdrant', async () => {
	const actual = await vi.importActual<typeof import('../qdrant')>('../qdrant');
	return {
		...actual,
		ensure: ensureMock,
		retrieve_one: retrieveOneMock,
		upsert: upsertMock
	};
});

import { match_blurb } from '../blurb';
import type { User } from '../../types';

const ada = { s: 'u', u: 'ada', a: 'i build synths', i: ['modular', 'jazz'] } as User;
const bo = { s: 'u', u: 'bo', a: 'i restore tape machines', i: ['analog'] } as User;
const env = { GROQ: 'gk', QDRANT_URL: 'u', QDRANT_KEY: 'k' };

beforeEach(() => {
	vi.clearAllMocks();
	ensureMock.mockResolvedValue(undefined);
	retrieveOneMock.mockResolvedValue(null);
	upsertMock.mockResolvedValue(undefined);
	generateTextMock.mockResolvedValue({ text: 'you both keep old analog gear alive' });
});

describe('match_blurb', () => {
	it('writes a line and caches it against the conversation', async () => {
		expect(await match_blurb(env, 'a|b', ada, bo)).toBe('you both keep old analog gear alive');
		expect(upsertMock).toHaveBeenCalledTimes(1);
		expect(upsertMock.mock.calls[0][1][0].payload).toMatchObject({
			s: 'mb',
			t: 'you both keep old analog gear alive'
		});
	});

	// gpt-oss reasons before it answers and bills the thinking against the same budget.
	// At 60 tokens it spent all of them thinking and returned '' — mocking hid that, so
	// pin the two settings that make a line come out at all.
	it('leaves the model room to think and still answer', async () => {
		await match_blurb(env, 'a|b', ada, bo);
		const args = generateTextMock.mock.calls[0][0];
		expect(args.maxOutputTokens).toBeGreaterThanOrEqual(200);
		expect(args.providerOptions).toEqual({ groq: { reasoning_effort: 'low' } });
	});

	it('serves the cached line without calling the model again', async () => {
		retrieveOneMock.mockResolvedValue({ id: 'x', payload: { s: 'mb', t: 'cached line' } });
		expect(await match_blurb(env, 'a|b', ada, bo)).toBe('cached line');
		expect(generateTextMock).not.toHaveBeenCalled();
	});

	it('spends nothing when either profile is empty', async () => {
		expect(await match_blurb(env, 'a|b', ada, { s: 'u', u: 'ghost' } as User)).toBe('');
		expect(generateTextMock).not.toHaveBeenCalled();
		expect(ensureMock).not.toHaveBeenCalled();
	});

	it('returns empty rather than throwing when the model fails', async () => {
		generateTextMock.mockRejectedValue(new Error('rate limited'));
		expect(await match_blurb(env, 'a|b', ada, bo)).toBe('');
	});

	it('returns empty when no groq key is configured', async () => {
		expect(await match_blurb({ ...env, GROQ: undefined }, 'a|b', ada, bo)).toBe('');
		expect(generateTextMock).not.toHaveBeenCalled();
	});

	it('keeps one line only, unquoted and bounded', async () => {
		generateTextMock.mockResolvedValue({
			text: `"both of you chase warm sound"\nand another thought entirely`
		});
		expect(await match_blurb(env, 'a|b', ada, bo)).toBe('both of you chase warm sound');
	});

	it('survives a cache read failure by generating instead', async () => {
		retrieveOneMock.mockRejectedValue(new Error('qdrant down'));
		expect(await match_blurb(env, 'a|b', ada, bo)).toBe('you both keep old analog gear alive');
	});
});
