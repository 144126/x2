import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { embed } from '../or';
import { ZV, type QEnv } from '../qdrant';

const ENV: QEnv = { QDRANT_URL: 'u', QDRANT_KEY: 'k', VOXELL_KEY: 'voxell-secret' };

describe('embed', () => {
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('returns the zero vector when no key is configured', async () => {
		const v = await embed({ QDRANT_URL: 'u', QDRANT_KEY: 'k' }, 'hello');
		expect(v).toBe(ZV);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('returns the zero vector for empty/whitespace-only text', async () => {
		expect(await embed(ENV, '')).toBe(ZV);
		expect(await embed(ENV, '   ')).toBe(ZV);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('calls the Voxell AI embeddings endpoint with the right model + auth', async () => {
		fetchMock.mockResolvedValue({
			ok: true,
			json: async () => ({ data: [{ embedding: [1, 2, 3] }] })
		});
		const v = await embed(ENV, 'about_user: hiking | user_interests: trail running');
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe('https://api.voxell.ai/v1/embeddings');
		expect(init.method).toBe('POST');
		expect(init.headers.Authorization).toBe('Bearer voxell-secret');
		expect(init.headers['Content-Type']).toBe('application/json');
		const body = JSON.parse(init.body);
		expect(body.model).toBe('jcorners/ingot-8b-r3');
		expect(body.input).toBe('about_user: hiking | user_interests: trail running');
		expect(v).toEqual([1, 2, 3]);
	});

	it('truncates input text to 8000 chars', async () => {
		fetchMock.mockResolvedValue({ ok: true, json: async () => ({ data: [{ embedding: [] }] }) });
		await embed(ENV, 'x'.repeat(9000));
		const body = JSON.parse(fetchMock.mock.calls[0][1].body);
		expect(body.input.length).toBe(8000);
	});

	it('resolves a secrets-store-style VOXELL_KEY binding', async () => {
		fetchMock.mockResolvedValue({ ok: true, json: async () => ({ data: [{ embedding: [9] }] }) });
		const env: QEnv = { QDRANT_URL: 'u', QDRANT_KEY: 'k', VOXELL_KEY: { get: async () => 'from-binding' } };
		await embed(env, 'hi');
		expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer from-binding');
	});

	it('returns the zero vector when the API responds with an error status', async () => {
		fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) });
		expect(await embed(ENV, 'hi')).toBe(ZV);
	});

	it('returns the zero vector when the fetch throws', async () => {
		fetchMock.mockRejectedValue(new Error('network down'));
		expect(await embed(ENV, 'hi')).toBe(ZV);
	});
});
