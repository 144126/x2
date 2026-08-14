import { it, expect, vi } from 'vitest';
const searchGroupsMock = vi.hoisted(() => vi.fn());
vi.mock('$lib/server/group', () => ({ search_groups: searchGroupsMock }));
vi.mock('$env/dynamic/private', () => ({ env: {} }));
import { load } from '../+page.server';

const at = (search: string) => ({ url: new URL(`https://x/${search}`) }) as never;

it('loads a short list of rooms as the fallback under the voice match', async () => {
	searchGroupsMock.mockResolvedValue([]);
	expect(await load(at(''))).toEqual({ q: '', rooms: [] });
	expect(searchGroupsMock).toHaveBeenCalledWith({}, '', undefined, 4);
});

it('searches rooms on the server, so the results are in the html', async () => {
	searchGroupsMock.mockResolvedValue([]);
	expect(await load(at('?q=chess'))).toEqual({ q: 'chess', rooms: [] });
	expect(searchGroupsMock).toHaveBeenCalledWith({}, 'chess', undefined, 8);
});
