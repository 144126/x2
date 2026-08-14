import { describe, it, expect, vi, beforeEach } from 'vitest';

const { ensureMock, upsertMock, scrollMock, getUserMock, embedMock } = vi.hoisted(() => ({
	ensureMock: vi.fn(),
	upsertMock: vi.fn(),
	scrollMock: vi.fn(),
	getUserMock: vi.fn(),
	embedMock: vi.fn()
}));

vi.mock('../qdrant', async () => {
	const actual = await vi.importActual<typeof import('../qdrant')>('../qdrant');
	return { ...actual, ensure: ensureMock, upsert: upsertMock, scroll: scrollMock };
});
vi.mock('../user', () => ({ get_user: getUserMock }));
vi.mock('../or', () => ({ embed: embedMock }));

import { save_profile } from '../profile';

const ENV = { QDRANT_URL: 'u', QDRANT_KEY: 'k' };
const PLACED = {
	s: 'u' as const,
	g: 'sub',
	n: 'Ada',
	d: 1000,
	o: 'google' as const,
	u: 'ada',
	co: 'NG',
	st: 'FC',
	ci: 'Abuja'
};
const payload = () => upsertMock.mock.calls[0][1][0].payload;

beforeEach(() => {
	vi.clearAllMocks();
	ensureMock.mockResolvedValue(undefined);
	upsertMock.mockResolvedValue(undefined);
	embedMock.mockResolvedValue([0.5, 0.6]);
	scrollMock.mockResolvedValue([]);
	getUserMock.mockResolvedValue({ ...PLACED });
});

describe('clearing a profile location', () => {
	it('stores an empty country when the form sends one', async () => {
		await save_profile(ENV, 'uid', { country: '' });
		expect(payload().co).toBe('');
	});

	it('stores an empty state when the form sends one', async () => {
		await save_profile(ENV, 'uid', { state: '' });
		expect(payload().st).toBe('');
	});

	it('clears country and state together, the way the picker cascades', async () => {
		await save_profile(ENV, 'uid', { country: '', state: '', city: '' });
		expect(payload().co).toBe('');
		expect(payload().st).toBe('');
		expect(payload().ci).toBe('');
	});

	it('keeps the stored location when the fields are omitted', async () => {
		await save_profile(ENV, 'uid', { about: 'hello' });
		expect(payload().co).toBe('NG');
		expect(payload().st).toBe('FC');
		expect(payload().ci).toBe('Abuja');
	});

	it('clears the state on its own, leaving the country alone', async () => {
		await save_profile(ENV, 'uid', { state: '' });
		expect(payload().co).toBe('NG');
		expect(payload().st).toBe('');
	});
});
