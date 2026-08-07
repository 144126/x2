import { describe, it, expect, vi, beforeEach } from 'vitest';

const { ensureMock, upsertMock, retrieveOneMock, retrieveManyMock, scrollMock } = vi.hoisted(
	() => ({
		ensureMock: vi.fn(),
		upsertMock: vi.fn(),
		retrieveOneMock: vi.fn(),
		retrieveManyMock: vi.fn(),
		scrollMock: vi.fn()
	})
);

vi.mock('../qdrant', async () => {
	const actual = await vi.importActual<typeof import('../qdrant')>('../qdrant');
	return {
		...actual,
		ensure: ensureMock,
		upsert: upsertMock,
		retrieve_one: retrieveOneMock,
		retrieve_many: retrieveManyMock,
		scroll: scrollMock
	};
});

import {
	save_user,
	get_user,
	create_pw_user,
	verify_user_pw,
	patch_user,
	get_user_names,
	find_user_by_email,
	find_user_by_google_sub
} from '../user';
import { uuid_from, V } from '../qdrant';
import { hash_pw } from '../pw';

const ENV = { QDRANT_URL: 'u', QDRANT_KEY: 'k' };

beforeEach(() => {
	vi.clearAllMocks();
	ensureMock.mockResolvedValue(undefined);
	upsertMock.mockResolvedValue(undefined);
	retrieveOneMock.mockResolvedValue(null);
	scrollMock.mockResolvedValue([]); // username uniqueness lookup: nothing taken
});

describe('save_user', () => {
	it('creates a new google user keyed by a deterministic uuid of the sub', async () => {
		const id = await save_user(ENV, 'google-sub-1', 'pic.png', 'ada@example.com');
		expect(id).toBe(await uuid_from('google-sub-1'));
		expect(ensureMock).toHaveBeenCalledWith(ENV);
		const [, points] = upsertMock.mock.calls[0];
		expect(points[0].id).toBe(id);
		expect(points[0].vector).toEqual({});
		expect(points[0].payload).toMatchObject({
			s: 'u',
			g: 'google-sub-1',
			p: 'pic.png',
			m: 'ada@example.com',
			o: 'google'
		});
	});

	it('derives the username from the email local-part and never stores the google name', async () => {
		await save_user(ENV, 'google-sub-2', undefined, 'Ada.Lovelace@gmail.com');
		const payload = upsertMock.mock.calls[0][1][0].payload;
		expect(payload.u).toBe('ada_lovelace');
		expect(payload.n).toBeUndefined();
	});

	it('preserves creation date, password hash and the existing username', async () => {
		retrieveOneMock.mockResolvedValue({
			id: 'x',
			payload: { s: 'u', g: 'g', u: 'chosen_name', d: 12345, o: 'local', h: 'existing-hash' }
		});
		await save_user(ENV, 'g');
		const payload = upsertMock.mock.calls[0][1][0].payload;
		expect(payload.d).toBe(12345);
		expect(payload.h).toBe('existing-hash');
		expect(payload.u).toBe('chosen_name');
	});
});

describe('get_user', () => {
	it('returns the user payload when s === "u"', async () => {
		retrieveOneMock.mockResolvedValue({ id: 'x', payload: { s: 'u', u: 'ada' } });
		expect(await get_user(ENV, 'x')).toEqual({ s: 'u', u: 'ada' });
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

	it('writes no vector — a fresh account has no content yet', async () => {
		await create_pw_user(ENV, 'e@x.com', 'hunter22');
		expect(upsertMock.mock.calls[0][1][0].vector).toEqual({});
	});
});

describe('find_user_by_email', () => {
	it('returns null when no account carries that email', async () => {
		scrollMock.mockResolvedValue([]);
		expect(await find_user_by_email(ENV, 'nobody@x.com')).toBeNull();
	});

	it('returns the record and its point id when an account carries that email', async () => {
		scrollMock.mockResolvedValue([{ id: 'dev-uid', payload: { s: 'u', m: 'e@x.com', u: 'ada' } }]);
		const found = await find_user_by_email(ENV, 'e@x.com');
		expect(found?.id).toBe('dev-uid');
		expect(found?.m).toBe('e@x.com');
	});
});

describe('find_user_by_google_sub', () => {
	it('returns null when no account carries that sub', async () => {
		scrollMock.mockResolvedValue([]);
		expect(await find_user_by_google_sub(ENV, 'sub-1')).toBeNull();
	});

	it('finds a pure google account by its g anchor', async () => {
		scrollMock.mockResolvedValue([{ id: 'gid', payload: { s: 'u', g: 'sub-1', u: 'ada' } }]);
		const found = await find_user_by_google_sub(ENV, 'sub-1');
		expect(found?.id).toBe('gid');
	});

	it('finds a linked account by its gl field', async () => {
		scrollMock.mockResolvedValue([
			{ id: 'dev-uid', payload: { s: 'u', g: 'device-xyz', gl: 'sub-2', u: 'ada' } }
		]);
		const found = await find_user_by_google_sub(ENV, 'sub-2');
		expect(found?.id).toBe('dev-uid');
	});
});

describe('verify_user_pw', () => {
	it('returns the user on a correct password', async () => {
		const h = await hash_pw('hunter22');
		retrieveOneMock.mockResolvedValue({
			id: 'x',
			payload: { s: 'u', o: 'local', h, m: 'e@x.com' }
		});
		const u = await verify_user_pw(ENV, 'e@x.com', 'hunter22');
		expect(u?.m).toBe('e@x.com');
	});

	it('resolves a linked-from-device account by email index, at its real id, not uuid_from(email)', async () => {
		const h = await hash_pw('hunter22');
		scrollMock.mockResolvedValue([
			{ id: 'dev-uid', payload: { s: 'u', o: 'local', h, m: 'e@x.com', u: 'ada' } }
		]);
		const u = await verify_user_pw(ENV, 'e@x.com', 'hunter22');
		expect(u?.id).toBe('dev-uid');
		expect(u?.id).not.toBe(await uuid_from('e@x.com'));
	});

	it('still verifies a pre-existing pure-password account via the legacy derived-id path', async () => {
		const h = await hash_pw('hunter22');
		scrollMock.mockResolvedValue([]);
		retrieveOneMock.mockResolvedValue({
			id: await uuid_from('e@x.com'),
			payload: { s: 'u', o: 'local', h, m: 'e@x.com', u: 'ada' }
		});
		const u = await verify_user_pw(ENV, 'e@x.com', 'hunter22');
		expect(u?.id).toBe(await uuid_from('e@x.com'));
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

describe('patch_user', () => {
	it('merges the patch onto the existing record', async () => {
		retrieveOneMock.mockResolvedValue({
			id: 'x',
			vector: { [V]: [1, 2, 3] },
			payload: { s: 'u', u: 'ada', d: 1 }
		});
		const merged = await patch_user(ENV, 'x', { ac: 'CODE1' });
		expect(merged).toMatchObject({ u: 'ada', ac: 'CODE1' });
	});

	it('preserves the existing search embedding rather than resetting it', async () => {
		retrieveOneMock.mockResolvedValue({
			id: 'x',
			vector: { [V]: [1, 2, 3] },
			payload: { s: 'u', u: 'ada', d: 1 }
		});
		await patch_user(ENV, 'x', { ac: 'CODE1' });
		expect(upsertMock.mock.calls[0][1][0].vector).toEqual({ [V]: [1, 2, 3] });
	});

	it('writes no vector when the point had none', async () => {
		retrieveOneMock.mockResolvedValue({
			id: 'x',
			vector: undefined,
			payload: { s: 'u', u: 'ada', d: 1 }
		});
		await patch_user(ENV, 'x', { ac: 'CODE1' });
		expect(upsertMock.mock.calls[0][1][0].vector).toEqual({});
	});

	it('returns null for a user that does not exist', async () => {
		retrieveOneMock.mockResolvedValue(null);
		expect(await patch_user(ENV, 'ghost', { ac: 'CODE1' })).toBeNull();
		expect(upsertMock).not.toHaveBeenCalled();
	});
});

describe('get_user_names', () => {
	it('issues exactly one batched retrieve call for N ids', async () => {
		retrieveManyMock.mockResolvedValue([
			{ id: 'bob', payload: { s: 'u', u: 'bobby' } },
			{ id: 'carol', payload: { s: 'u', u: 'caro' } }
		]);
		await get_user_names(ENV, ['bob', 'carol']);
		expect(retrieveManyMock).toHaveBeenCalledTimes(1);
	});

	it('dedupes repeated ids', async () => {
		retrieveManyMock.mockResolvedValue([{ id: 'bob', payload: { s: 'u', u: 'bobby' } }]);
		const names = await get_user_names(ENV, ['bob', 'bob']);
		expect(retrieveManyMock).toHaveBeenCalledWith(expect.anything(), ['bob']);
	});

	it('maps id to username', async () => {
		retrieveManyMock.mockResolvedValue([{ id: 'bob', payload: { s: 'u', u: 'bobby' } }]);
		const names = await get_user_names(ENV, ['bob']);
		expect(names).toEqual({ bob: 'bobby' });
	});

	it('falls back to the raw id for a point that does not exist in the response', async () => {
		retrieveManyMock.mockResolvedValue([{ id: 'bob', payload: { s: 'u', u: 'bobby' } }]);
		const names = await get_user_names(ENV, ['bob', 'ghost']);
		expect(names).toEqual({ bob: 'bobby', ghost: 'ghost' });
	});

	it('falls back to the raw id for a point whose payload is not s: "u"', async () => {
		retrieveManyMock.mockResolvedValue([{ id: 'msg1', payload: { s: 'm', x: 'hello' } }]);
		const names = await get_user_names(ENV, ['msg1']);
		expect(names).toEqual({ msg1: 'msg1' });
	});
});
