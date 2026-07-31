import { describe, it, expect, vi } from 'vitest';
const searchGroupsMock = vi.hoisted(() => vi.fn());
vi.mock('$lib/server/group', () => ({ search_groups: searchGroupsMock }));
vi.mock('$env/dynamic/private', () => ({ env: {} }));
import { load } from '../+page.server';

it('loads public rooms with an empty query by default', async () => {
	searchGroupsMock.mockResolvedValue([]);
	await load({ url: new URL('https://x/') } as never);
	expect(searchGroupsMock).toHaveBeenCalledWith({}, '', undefined, 12);
});
it('forwards ?q= to search_groups', async () => {
	searchGroupsMock.mockResolvedValue([]);
	await load({ url: new URL('https://x/?q=chess') } as never);
	expect(searchGroupsMock).toHaveBeenCalledWith({}, 'chess', undefined, 12);
});
