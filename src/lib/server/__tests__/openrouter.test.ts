import { describe, it, expect, vi } from 'vitest';

vi.mock('@ai-sdk/openai-compatible', () => ({
	createOpenAICompatible: (cfg: { baseURL: string; apiKey: string }) => (id: string) => ({
		id,
		...cfg
	})
}));

import { serialize_thread, thread_model, THREAD_MODEL } from '../openrouter';
import { thread_cost_kobo } from '../pricing';
import type { Message } from '../../types';

describe('thread_model', () => {
	it('points at openrouter with the pinned model', async () => {
		const m = (await thread_model({ OPENROUTER: 'k' } as never)) as unknown as {
			id: string;
			baseURL: string;
			apiKey: string;
		};
		expect(m.id).toBe('deepseek/deepseek-v4-flash-0731');
		expect(m.baseURL).toBe('https://openrouter.ai/api/v1');
		expect(m.apiKey).toBe('k');
	});

	it('is null when the key is not bound, so no url is built from undefined', async () => {
		expect(await thread_model({} as never)).toBeNull();
	});
});

describe('thread_cost_kobo', () => {
	it('prices the model the endpoint actually calls', () => {
		expect(THREAD_MODEL).toBe('deepseek/deepseek-v4-flash-0731');
		// 1M in + 1M out = $0.14 + $0.28 = $0.42, at 1440 NGN/USD
		expect(thread_cost_kobo(1_000_000, 1_000_000)).toBe(Math.round(0.42 * 1440 * 100));
	});

	it('costs nothing when nothing was spent', () => {
		expect(thread_cost_kobo(0, 0)).toBe(0);
	});

	it('charges output at twice the input rate', () => {
		expect(thread_cost_kobo(0, 1_000_000)).toBe(2 * thread_cost_kobo(1_000_000, 0));
	});
});

describe('serialize_thread', () => {
	const my = 'ada';

	it('maps own messages to user role', () => {
		const msgs: Message[] = [{ s: 'm', id: '1', c: 'a|b', f: 'ada', t: 'bob', x: 'hello', d: 100 }];
		const r = serialize_thread(msgs, my);
		expect(r[0].role).toBe('user');
		expect(r[0].content).toBe('hello');
	});

	it('maps peer messages to assistant role', () => {
		const msgs: Message[] = [{ s: 'm', id: '1', c: 'a|b', f: 'bob', t: 'ada', x: 'hi', d: 100 }];
		const r = serialize_thread(msgs, my);
		expect(r[0].role).toBe('assistant');
		expect(r[0].content).toBe('hi');
	});

	it('labels attachment-only messages as (attachment)', () => {
		const msgs: Message[] = [
			{ s: 'm', id: '1', c: 'a|b', f: 'ada', t: 'bob', x: '', d: 100, im: 'img.png' }
		];
		expect(serialize_thread(msgs, my)[0].content).toBe('(attachment)');
	});
});
