import { describe, it, expect, vi, beforeEach } from 'vitest';

const { ensureMock, upsertMock, retrieveOneMock } = vi.hoisted(() => ({
	ensureMock: vi.fn(),
	upsertMock: vi.fn(),
	retrieveOneMock: vi.fn()
}));

vi.mock('../qdrant', async () => {
	const actual = await vi.importActual<typeof import('../qdrant')>('../qdrant');
	return { ...actual, ensure: ensureMock, upsert: upsertMock, retrieve_one: retrieveOneMock };
});

import { save_user, get_user, create_pw_user, verify_user_pw } from '../user';
import { uuid_from, ZV } from '../qdrant';
import { hash_pw } from '../pw';

const ENV = { QDRANT_URL: 'u', QDRANT_KEY: 'k' };

beforeEach(() => {
	vi.clearAllMocks();
	ensureMock.mockResolvedValue(undefined);
	upsertMock.mockResolvedValue(undefined);
	retrieveOneMock.mockResolvedValue(null);
});

describe('save_user', () => {
	it('creates a new google user keyed by a deterministic uuid of the sub', async () => {
		const id = await save_user(ENV, 'google-sub-1', 'Ada', 'pic.png', 'ada@example.com');
		expect(id).toBe(await uuid_from('google-sub-1'));
		expect(ensureMock).toHaveBeenCalledWith(ENV);
		const [, points] = upsertMock.mock.calls[0];
		expect(points[0].id).toBe(id);
		expect(points[0].vector).toBe(ZV);
		expect(points[0].payload).toMatchObject({
			s: 'u',
			g: 'google-sub-1',
			n: 'Ada',
			p: 'pic.png',
			m: 'ada@example.com',
			o: 'google'
		});
	});

	it('preserves creation date and password hash from an existing record', async () => {
		retrieveOneMock.mockResolvedValue({
			id: 'x',
			payload: { s: 'u', g: 'g', n: 'old-name', d: 12345, o: 'local', h: 'existing-hash' }
		});
		await save_user(ENV, 'g', 'New Name');
		const payload = upsertMock.mock.calls[0][1][0].payload;
		expect(payload.d).toBe(12345);
		expect(payload.h).toBe('existing-hash');
		expect(payload.n).toBe('New Name');
	});
});

describe('get_user', () => {
	it('returns the user payload when s === "u"', async () => {
		retrieveOneMock.mockResolvedValue({ id: 'x', payload: { s: 'u', n: 'Ada' } });
		expect(await get_user(ENV, 'x')).toEqual({ s: 'u', n: 'Ada' });
	});

	it('returns null when the record is not a user (e.g. a message)', async () => {
		retrieveOneMock.mockResolvedValue({ id: 'x', payload: { s: 'm' } });
		expect(await get_user(ENV, 'x')).toBeNull();
	});

	it('returns null when nothing is found', async () => {
		retrieveOneMock.mockResolvedValue(null);
		expect(await get_user(ENV, 'missing')).toBeNull();
	});
});

describe('create_pw_user', () => {
	it('hashes the password and stores a local-provider user keyed by email uuid', async () => {
		const id = await create_pw_user(ENV, 'e@x.com', 'hunter22');
		expect(id).toBe(await uuid_from('e@x.com'));
		expect(ensureMock).toHaveBeenCalledWith(ENV);
		const payload = upsertMock.mock.calls[0][1][0].payload;
		expect(payload.o).toBe('local');
		expect(payload.g).toBe('e@x.com');
		expect(payload.m).toBe('e@x.com');
		expect(payload.h).not.toBe('hunter22');
		expect(payload.h.split('.')).toHaveLength(2);
	});
});

describe('verify_user_pw', () => {
	it('returns the user on a correct password', async () => {
		const h = await hash_pw('hunter22');
		retrieveOneMock.mockResolvedValue({ id: 'x', payload: { s: 'u', o: 'local', h, m: 'e@x.com' } });
		const u = await verify_user_pw(ENV, 'e@x.com', 'hunter22');
		expect(u?.m).toBe('e@x.com');
	});

	it('returns null on a wrong password', async () => {
		const h = await hash_pw('hunter22');
		retrieveOneMock.mockResolvedValue({ id: 'x', payload: { s: 'u', o: 'local', h } });
		expect(await verify_user_pw(ENV, 'e@x.com', 'wrong')).toBeNull();
	});

	it('returns null for a google-provider account (no local password)', async () => {
		retrieveOneMock.mockResolvedValue({ id: 'x', payload: { s: 'u', o: 'google' } });
		expect(await verify_user_pw(ENV, 'e@x.com', 'anything')).toBeNull();
	});

	it('returns null when the user does not exist', async () => {
		retrieveOneMock.mockResolvedValue(null);
		expect(await verify_user_pw(ENV, 'nobody@x.com', 'anything')).toBeNull();
	});
});
