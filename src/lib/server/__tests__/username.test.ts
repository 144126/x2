import { describe, it, expect, vi, beforeEach } from 'vitest';

const { scrollMock } = vi.hoisted(() => ({ scrollMock: vi.fn() }));
vi.mock('../qdrant', async () => {
	const actual = await vi.importActual<typeof import('../qdrant')>('../qdrant');
	return { ...actual, scroll: scrollMock };
});

import { normalize_username, validate_username, username_free, available_username } from '../username';

const ENV = { QDRANT_URL: 'u', QDRANT_KEY: 'k' };

beforeEach(() => {
	vi.clearAllMocks();
	scrollMock.mockResolvedValue([]);
});

describe('normalize_username', () => {
	it('takes the email local-part and makes it legal', () => {
		expect(normalize_username('Ada.Lovelace@gmail.com')).toBe('ada_lovelace');
		expect(normalize_username('a+b@x.com')).toBe('a_b');
	});

	it('always returns something usable', () => {
		expect(validate_username(normalize_username('!!!'))).not.toBeNull();
		expect(validate_username(normalize_username('a'.repeat(50)))).not.toBeNull();
	});
});

describe('validate_username', () => {
	it('rejects hyphens, spaces, capitals and short names', () => {
		for (const bad of ['new-handle', 'has space', 'Caps', 'ab', 'a'.repeat(21)])
			expect(validate_username(bad)).toBeNull();
		expect(validate_username('ada_lovelace9')).toBe('ada_lovelace9');
	});
});

describe('username_free', () => {
	it('is free when nobody holds it, or only you do', async () => {
		expect(await username_free(ENV, 'ada')).toBe(true);
		scrollMock.mockResolvedValue([{ id: 'me', payload: {} }]);
		expect(await username_free(ENV, 'ada', 'me')).toBe(true);
		expect(await username_free(ENV, 'ada', 'someone')).toBe(false);
	});
});

describe('available_username', () => {
	it('suffixes on collision until one is free', async () => {
		scrollMock.mockImplementation(async (_e: unknown, filter: { must: { match: { value: string } }[] }) => {
			const wanted = filter.must[1].match.value;
			return wanted === 'ada' || wanted === 'ada2' ? [{ id: 'other', payload: {} }] : [];
		});
		expect(await available_username(ENV, 'ada', 'me')).toBe('ada3');
	});

	it('keeps the result legal when the base is already full length', async () => {
		scrollMock.mockImplementation(async (_e: unknown, filter: { must: { match: { value: string } }[] }) =>
			filter.must[1].match.value.length === 20 ? [{ id: 'other', payload: {} }] : []
		);
		const name = await available_username(ENV, 'a'.repeat(25), 'me');
		expect(validate_username(name)).not.toBeNull();
	});
});
