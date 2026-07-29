import { describe, it, expect, vi } from 'vitest';

const { ensureMock, listConvsMock, listFoldersMock } = vi.hoisted(() => ({
	ensureMock: vi.fn(),
	listConvsMock: vi.fn(),
	listFoldersMock: vi.fn()
}));

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$lib/server/qdrant', async () => {
	const actual = await vi.importActual<typeof import('$lib/server/qdrant')>('$lib/server/qdrant');
	return { ...actual, ensure: ensureMock };
});
vi.mock('$lib/server/chat', () => ({ list_conversations: listConvsMock, get_user_name: vi.fn() }));
vi.mock('$lib/server/folders', () => ({ list_folders: listFoldersMock }));

import { load } from '../+page.server';

function event(uid: string | null = 'me') {
	return {
		locals: { user: uid ? { id: uid, username: 'me' } : null }
	} as unknown as Parameters<typeof load>[0];
}

describe('GET /app — people search page', () => {
	it('401s when signed out', async () => {
		await expect(load(event(null))).rejects.toMatchObject({ status: 401 });
	});

	it('does not call list_conversations', async () => {
		await load(event('me'));
		expect(listConvsMock).not.toHaveBeenCalled();
	});

	it('does not call list_folders', async () => {
		await load(event('me'));
		expect(listFoldersMock).not.toHaveBeenCalled();
	});
});
