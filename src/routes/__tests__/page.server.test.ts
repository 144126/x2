import { it, expect, vi } from 'vitest';
const searchGroupsMock = vi.hoisted(() => vi.fn());
vi.mock('$lib/server/group', () => ({ search_groups: searchGroupsMock }));
vi.mock('$env/dynamic/private', () => ({ env: {} }));
import { load } from '../+page.server';

it('loads a short list of rooms as the fallback under the voice match', async () => {
	searchGroupsMock.mockResolvedValue([]);
	expect(await load({} as never)).toEqual({ rooms: [] });
	expect(searchGroupsMock).toHaveBeenCalledWith({}, '', undefined, 4);
});
