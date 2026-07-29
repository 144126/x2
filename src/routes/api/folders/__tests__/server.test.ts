import { describe, it, expect, vi, beforeEach } from 'vitest';

const { saveFolderMock, listFoldersMock } = vi.hoisted(() => ({
	saveFolderMock: vi.fn(),
	listFoldersMock: vi.fn()
}));

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$lib/server/folders', () => ({
	save_folder: saveFolderMock,
	list_folders: listFoldersMock
}));

import { GET, POST } from '../+server';

function event(uid: string | null, body?: unknown, qs = '') {
	const u = `https://x/api/folders${qs}`;
	return {
		request: new Request(u, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: body !== undefined ? JSON.stringify(body) : undefined
		}),
		url: new URL(u),
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

	it('filters the GET list by the kind query param', async () => {
		listFoldersMock.mockResolvedValue([]);
		await GET(event('ada', undefined, '?kind=r'));
		expect(listFoldersMock).toHaveBeenCalledWith({}, 'ada', 'r');
	});

	it('ignores an unrecognised kind param, returning everything', async () => {
		listFoldersMock.mockResolvedValue([]);
		await GET(event('ada', undefined, '?kind=x'));
		expect(listFoldersMock).toHaveBeenCalledWith({}, 'ada', undefined);
	});
});

describe('POST /api/folders', () => {
	it('400s without a name', async () => {
		await expect(POST(event('ada', {}))).rejects.toMatchObject({ status: 400 });
	});

	it('creates a folder', async () => {
		saveFolderMock.mockResolvedValue({ id: '1', name: 'close friends', convs: [], k: 'c' });
		const body = await (await POST(event('ada', { name: 'close friends' }))).json();
		expect(body.folder).toMatchObject({ name: 'close friends' });
		expect(saveFolderMock).toHaveBeenCalledWith({}, 'ada', 'close friends', 'c');
	});

	it('passes the kind through on POST', async () => {
		saveFolderMock.mockResolvedValue({ id: '1', name: 'rooms', convs: [], k: 'r' });
		const body = await (await POST(event('ada', { name: 'rooms', kind: 'r' }))).json();
		expect(body.folder).toMatchObject({ name: 'rooms', k: 'r' });
		expect(saveFolderMock).toHaveBeenCalledWith({}, 'ada', 'rooms', 'r');
	});

	it('defaults to the chat kind for a body with no kind', async () => {
		saveFolderMock.mockReset();
		saveFolderMock.mockResolvedValue({ id: '1', name: 'f', convs: [], k: 'c' });
		await POST(event('ada', { name: 'f' }));
		expect(saveFolderMock).toHaveBeenCalledWith({}, 'ada', 'f', 'c');
	});

	it('rejects an unrecognised kind by falling back to c', async () => {
		saveFolderMock.mockReset();
		saveFolderMock.mockResolvedValue({ id: '1', name: 'f', convs: [], k: 'c' });
		await POST(event('ada', { name: 'f', kind: 'x' }));
		expect(saveFolderMock).toHaveBeenCalledWith({}, 'ada', 'f', 'c');
	});
});
