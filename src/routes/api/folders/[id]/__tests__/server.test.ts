import { describe, it, expect, vi, beforeEach } from 'vitest';

const { assignConvMock, unassignConvMock, deleteFolderMock } = vi.hoisted(() => ({
	assignConvMock: vi.fn(),
	unassignConvMock: vi.fn(),
	deleteFolderMock: vi.fn()
}));

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$lib/server/folders', () => ({
	assign_conv: assignConvMock,
	unassign_conv: unassignConvMock,
	delete_folder: deleteFolderMock
}));

import { POST, DELETE } from '../+server';

function event(uid: string | null, id: string, opts: { body?: unknown; conv?: string } = {}) {
	return {
		request: new Request('https://x/api/folders/' + id, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
		}),
		params: { id },
		url: new URL(`https://x/api/folders/${id}${opts.conv ? `?conv=${opts.conv}` : ''}`),
		locals: { user: uid ? { id: uid, username: 'ada' } : null }
	} as unknown as Parameters<typeof POST>[0];
}

beforeEach(() => {
	vi.clearAllMocks();
	assignConvMock.mockResolvedValue(true);
	unassignConvMock.mockResolvedValue(true);
	deleteFolderMock.mockResolvedValue(true);
});

describe('POST /api/folders/[id]', () => {
	it('401s when signed out', async () => {
		await expect(POST(event(null, 'f1', { body: { conv: 'bob' } }))).rejects.toMatchObject({
			status: 401
		});
	});

	it('400s without a conv', async () => {
		await expect(POST(event('ada', 'f1', { body: {} }))).rejects.toMatchObject({ status: 400 });
	});

	it('404s when the folder is not owned by the caller', async () => {
		assignConvMock.mockResolvedValue(false);
		await expect(POST(event('ada', 'f1', { body: { conv: 'bob' } }))).rejects.toMatchObject({
			status: 404
		});
	});

	it('assigns the conv on success', async () => {
		const body = await (await POST(event('ada', 'f1', { body: { conv: 'bob' } }))).json();
		expect(body).toEqual({ ok: true });
		expect(assignConvMock).toHaveBeenCalledWith({}, 'ada', 'f1', 'bob');
	});
});

describe('DELETE /api/folders/[id]', () => {
	it('unassigns a conv when ?conv= is present', async () => {
		const body = await (await DELETE(event('ada', 'f1', { conv: 'bob' }))).json();
		expect(body).toEqual({ ok: true });
		expect(unassignConvMock).toHaveBeenCalledWith({}, 'ada', 'f1', 'bob');
		expect(deleteFolderMock).not.toHaveBeenCalled();
	});

	it('deletes the whole folder without ?conv=', async () => {
		const body = await (await DELETE(event('ada', 'f1'))).json();
		expect(body).toEqual({ ok: true });
		expect(deleteFolderMock).toHaveBeenCalledWith({}, 'ada', 'f1');
	});

	it('404s when not found/owned', async () => {
		deleteFolderMock.mockResolvedValue(false);
		await expect(DELETE(event('ada', 'f1'))).rejects.toMatchObject({ status: 404 });
	});
});
