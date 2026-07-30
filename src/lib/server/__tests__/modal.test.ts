import { describe, it, expect } from 'vitest';
import { modal_cost_kobo, serialize_thread, MODAL_KOBO_PER_SEC } from '../modal';
import type { Message } from '../../types';

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
