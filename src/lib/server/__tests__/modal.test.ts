import { describe, it, expect, vi, beforeEach } from 'vitest';
import { modal_cost_kobo, serialize_thread, MODAL_KOBO_PER_SEC, MODAL_MODEL, modal_complete } from '../modal';
import type { Message } from '../../types';

beforeEach(() => {
	vi.stubGlobal('fetch', vi.fn());
});

describe('modal_complete', () => {
	it('requests the pinned model non-streaming and returns the trimmed content', async () => {
		vi.mocked(fetch).mockResolvedValue(
			new Response(
				JSON.stringify({ choices: [{ message: { content: '  you both love chess.  ' } }] })
			)
		);
		const env = { MODAL_ENDPOINT_URL: 'https://x.example' } as never;
		const text = await modal_complete(env, [{ role: 'user', content: 'hi' }]);
		expect(text).toBe('you both love chess.');
		const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
		expect(body.model).toBe('gemma-4-26b-a4b-it');
		expect(body.stream).toBe(false);
		expect(vi.mocked(fetch).mock.calls[0][0]).toBe('https://x.example/v1/chat/completions');
	});

	it('throws on non-ok response', async () => {
		vi.mocked(fetch).mockResolvedValue(new Response('server error', { status: 500 }));
		const env = { MODAL_ENDPOINT_URL: 'https://x.example' } as never;
		await expect(modal_complete(env, [{ role: 'user', content: 'hi' }])).rejects.toThrow(
			'modal_error'
		);
	});

	it('throws on empty content', async () => {
		vi.mocked(fetch).mockResolvedValue(
			new Response(JSON.stringify({ choices: [{ message: { content: '' } }] }))
		);
		const env = { MODAL_ENDPOINT_URL: 'https://x.example' } as never;
		await expect(modal_complete(env, [{ role: 'user', content: 'hi' }])).rejects.toThrow(
			'modal_empty'
		);
	});
});

describe('MODAL_MODEL', () => {
	it('is pinned to gemma-4-26b-a4b-it', () => {
		expect(MODAL_MODEL).toBe('gemma-4-26b-a4b-it');
	});
});

describe('modal_cost_kobo', () => {
	it('rounds seconds to kobo', () => {
		expect(modal_cost_kobo(1)).toBe(Math.round(MODAL_KOBO_PER_SEC));
	});

	it('scales linearly', () => {
		expect(modal_cost_kobo(10)).toBe(Math.round(MODAL_KOBO_PER_SEC * 10));
	});

	it('handles fractional seconds', () => {
		expect(modal_cost_kobo(0.5)).toBe(Math.round(MODAL_KOBO_PER_SEC * 0.5));
	});
});

describe('serialize_thread', () => {
	const my = 'ada';

	it('maps own messages to user role', () => {
		const msgs: Message[] = [
			{ s: 'm', id: '1', c: 'a|b', f: 'ada', t: 'bob', x: 'hello', d: 100 }
		];
		const r = serialize_thread(msgs, my);
		expect(r[0].role).toBe('user');
		expect(r[0].content).toBe('hello');
	});

	it('maps peer messages to assistant role', () => {
		const msgs: Message[] = [
			{ s: 'm', id: '1', c: 'a|b', f: 'bob', t: 'ada', x: 'hi', d: 100 }
		];
		const r = serialize_thread(msgs, my);
		expect(r[0].role).toBe('assistant');
		expect(r[0].content).toBe('hi');
	});

	it('labels attachment-only messages as (attachment)', () => {
		const msgs: Message[] = [
			{ s: 'm', id: '1', c: 'a|b', f: 'ada', t: 'bob', x: '', d: 100, im: 'img.png' }
		];
		const r = serialize_thread(msgs, my);
		expect(r[0].content).toBe('(attachment)');
	});
});
