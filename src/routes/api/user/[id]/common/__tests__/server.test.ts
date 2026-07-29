import { describe, it, expect, vi, beforeEach } from 'vitest';

const { retrieveOneMock, whatsInCommonMock } = vi.hoisted(() => ({
	retrieveOneMock: vi.fn(),
	whatsInCommonMock: vi.fn()
}));

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$lib/server/qdrant', async () => {
	const actual = await vi.importActual<typeof import('$lib/server/qdrant')>('$lib/server/qdrant');
	return { ...actual, retrieve_one: retrieveOneMock };
});
vi.mock('$lib/server/groq', () => ({ whats_in_common: whatsInCommonMock }));

import { GET } from '../+server';

function event(uid: string | null, id: string) {
	return {
		params: { id },
		locals: { user: uid ? { id: uid, username: 'ada' } : null, x2_ws: {} }
	} as unknown as Parameters<typeof GET>[0];
}

beforeEach(() => {
	vi.clearAllMocks();
	retrieveOneMock.mockImplementation(async (_e, id) => ({ id, payload: { s: 'u', u: id, d: 1 } }));
	whatsInCommonMock.mockResolvedValue({ ok: true, text: 'you both love music', cost_kobo: 5 });
});

describe('GET /api/user/[id]/common', () => {
	it('401s when signed out', async () => {
		await expect(GET(event(null, 'bob'))).rejects.toMatchObject({ status: 401 });
	});

	it('404s when the other user does not exist', async () => {
		retrieveOneMock.mockResolvedValueOnce(undefined);
		await expect(GET(event('ada', 'ghost'))).rejects.toMatchObject({ status: 404 });
	});

	it('calls whats_in_common with the viewer as spender and returns the text', async () => {
		const body = await (await GET(event('ada', 'bob'))).json();
		expect(whatsInCommonMock).toHaveBeenCalledWith(
			{},
			{},
			'ada',
			expect.objectContaining({ u: 'ada' }),
			expect.objectContaining({ u: 'bob' })
		);
		expect(body).toEqual({ ok: true, text: 'you both love music' });
	});

	it('returns insufficient_credits without a 5xx', async () => {
		whatsInCommonMock.mockResolvedValue({ ok: false, reason: 'insufficient_credits' });
		const res = await GET(event('ada', 'bob'));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: false, reason: 'insufficient_credits' });
	});
});
