import { describe, it, expect, vi, beforeEach } from 'vitest';

const { saveFolderMock, listFoldersMock } = vi.hoisted(() => ({
	saveFolderMock: vi.fn(),
	listFoldersMock: vi.fn()
}));

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$lib/server/folders', () => ({ save_folder: saveFolderMock, list_folders: listFoldersMock }));

import { GET, POST } from '../+server';

function event(uid: string | null, body?: unknown) {
	return {
		request: new Request('https://x/api/folders', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: body !== undefined ? JSON.stringify(body) : undefined
		}),
		locals: { user: uid ? { id: uid, username: 'ada' } : null }
	} as unknown as Parameters<typeof GET>[0];
}

beforeEach(() => {
	vi.clearAllMocks();
	listFoldersMock.mockResolvedValue([{ id: '1', name: 'x', convs: [] }]);
	saveFolderMock.mockResolvedValue({ id: '1', name: 'close friends', convs: [] });
});

describe('GET /api/folders', () => {
	it('401s when signed out', async () => {
		await expect(GET(event(null))).rejects.toMatchObject({ status: 401 });
	});

	it("lists the caller's folders", async () => {
		const body = await (await GET(event('ada'))).json();
		expect(body.folders).toHaveLength(1);
	});
});

describe('POST /api/folders', () => {
	it('400s without a name', async () => {
		await expect(POST(event('ada', {}))).rejects.toMatchObject({ status: 400 });
	});

	it('creates a folder', async () => {
		const body = await (await POST(event('ada', { name: 'close friends' }))).json();
		expect(body.folder).toMatchObject({ name: 'close friends' });
		expect(saveFolderMock).toHaveBeenCalledWith({}, 'ada', 'close friends');
	});
});
