import { describe, it, expect, vi, beforeEach } from 'vitest';

const { putImageMock } = vi.hoisted(() => ({ putImageMock: vi.fn() }));

vi.mock('$env/dynamic/private', () => ({ env: { SECRET: 'test-secret' } }));
vi.mock('$lib/server/media', async () => {
	const actual = await vi.importActual<typeof import('$lib/server/media')>('$lib/server/media');
	return { ...actual, put_image: putImageMock };
});

import { POST } from '../+server';

function event(form: FormData, uid: string | null = 'ada') {
	return {
		request: new Request('https://x/share', { method: 'POST', body: form }),
		locals: { user: uid ? { id: uid, username: 'ada' } : null },
		platform: { env: { MEDIA: {} } }
	} as unknown as Parameters<typeof POST>[0];
}

const form = (fields: Record<string, string | Blob>) => {
	const f = new FormData();
	for (const [k, v] of Object.entries(fields)) f.append(k, v);
	return f;
};

const png = (bytes = 10) => new Blob([new Uint8Array(bytes)], { type: 'image/png' });

/** SvelteKit's `redirect` throws; catch it and read the Location */
async function location_of(p: unknown): Promise<string> {
	try {
		await p;
	} catch (e) {
		return (e as { location: string }).location;
	}
	throw new Error('expected a redirect');
}

beforeEach(() => {
	vi.clearAllMocks();
	putImageMock.mockResolvedValue({
		key: 'ada/shared.png',
		url: '/media/ada/shared.png?e=1800000000000&s=abcdef1234567890abcdef1234567890'
	});
});

describe('POST /share — content shared from the OS', () => {
	it('sends a signed-out sharer to log in first', async () => {
		expect(await location_of(POST(event(form({ text: 'hi' }), null)))).toContain('/login');
	});

	it('carries shared text into the app so the user can pick a recipient', async () => {
		const to = await location_of(POST(event(form({ text: 'look at this' }))));
		expect(new URL(to, 'https://x').searchParams.get('share_text')).toBe('look at this');
	});

	it('appends a shared url to the text — most apps share both', async () => {
		const to = await location_of(POST(event(form({ text: 'read', url: 'https://a.example' }))));
		expect(new URL(to, 'https://x').searchParams.get('share_text')).toContain('https://a.example');
	});

	it('falls back to the title when no text is shared', async () => {
		const to = await location_of(POST(event(form({ title: 'a headline' }))));
		expect(new URL(to, 'https://x').searchParams.get('share_text')).toBe('a headline');
	});

	it('stores a shared image and passes its key along', async () => {
		const to = await location_of(POST(event(form({ image: png() }))));
		expect(putImageMock).toHaveBeenCalled();
		expect(new URL(to, 'https://x').searchParams.get('share_image')).toBe('ada/shared.png');
	});

	it('keys the shared image to the sharer, not to whatever the OS claimed', async () => {
		await location_of(POST(event(form({ image: png() }))));
		expect(putImageMock.mock.calls[0][1]).toBe('ada');
		expect(putImageMock.mock.calls[0][3]).toBe('test-secret');
	});

	it('drops a shared file that is not an image we accept', async () => {
		putImageMock.mockResolvedValue(null);
		const to = await location_of(POST(event(form({ image: png() }))));
		expect(new URL(to, 'https://x').searchParams.has('share_image')).toBe(false);
	});

	it('redirects a shared payload to the chats page', async () => {
		const to = await location_of(POST(event(form({ text: 'hi' }))));
		expect(new URL(to, 'https://x').pathname).toBe('/chats');
	});

	it('survives an empty share without erroring', async () => {
		expect(await location_of(POST(event(form({}))))).toContain('/chats');
	});
});
