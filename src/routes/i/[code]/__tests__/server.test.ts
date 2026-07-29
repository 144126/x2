import { describe, it, expect } from 'vitest';
import { GET } from '../+server';

describe('GET /i/[code]', () => {
	it('redirects to /login?c=<code>', async () => {
		await expect(GET({ params: { code: 'AbC12' } } as never)).rejects.toMatchObject({
			status: 302,
			location: '/login?c=abc12'
		});
	});

	it('redirects bare /i/ to /login', async () => {
		await expect(GET({ params: { code: '  ' } } as never)).rejects.toMatchObject({
			status: 302,
			location: '/login'
		});
	});
});
