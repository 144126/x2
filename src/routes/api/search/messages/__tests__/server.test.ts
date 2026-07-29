import { describe, it, expect, vi, beforeEach } from 'vitest';

const { searchMessagesMock } = vi.hoisted(() => ({ searchMessagesMock: vi.fn() }));

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$lib/server/chat', () => ({ search_messages: searchMessagesMock }));

import { GET } from '../+server';

function event(uid: string | null, q?: string, conv?: string) {
	const params = new URLSearchParams();
	if (q !== undefined) params.set('q', q);
	if (conv) params.set('conv', conv);
	return {
		url: new URL(`https://x/api/search/messages?${params}`),
		locals: { user: uid ? { id: uid, username: 'ada' } : null }
	} as unknown as Parameters<typeof GET>[0];
}

beforeEach(() => {
	vi.clearAllMocks();
	searchMessagesMock.mockResolvedValue([{ id: '1', x: 'found it' }]);
});

describe('GET /api/search/messages', () => {
	it('401s when signed out', async () => {
		await expect(GET(event(null, 'hi'))).rejects.toMatchObject({ status: 401 });
	});

	it('returns an empty list without a query, skipping the search call', async () => {
		const body = await (await GET(event('ada', ''))).json();
		expect(body).toEqual({ messages: [] });
		expect(searchMessagesMock).not.toHaveBeenCalled();
	});

	it('searches scoped to the caller', async () => {
		const body = await (await GET(event('ada', 'hello'))).json();
		expect(body.messages).toHaveLength(1);
		expect(searchMessagesMock).toHaveBeenCalledWith({}, 'ada', 'hello', undefined);
	});

	it('passes conv through when given', async () => {
		await GET(event('ada', 'hello', 'ada|bob'));
		expect(searchMessagesMock).toHaveBeenCalledWith({}, 'ada', 'hello', 'ada|bob');
	});
});
