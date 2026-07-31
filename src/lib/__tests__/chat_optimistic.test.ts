import { describe, it, expect } from 'vitest';
import { confirm_sent, mark_failed } from '../chat_optimistic';

describe('confirm_sent', () => {
	it('patches the matching message by cid and leaves others untouched', () => {
		const messages = [{ cid: 'a', id: '', d: 1 }, { cid: 'b', id: '', d: 2 }];
		const next = confirm_sent(messages, 'a', { id: 'real-id', d: 99 });
		expect(next).toEqual([{ cid: 'a', id: 'real-id', d: 99 }, { cid: 'b', id: '', d: 2 }]);
		expect(next).not.toBe(messages);
		expect(next[1]).toBe(messages[1]);
	});
	it('returns an equivalent array when no cid matches', () => {
		const messages = [{ cid: 'a', id: '', d: 1 }];
		expect(confirm_sent(messages, 'zzz', { id: 'x' })).toEqual(messages);
	});
});

describe('mark_failed', () => {
	it('sets err on the matching message only', () => {
		const messages = [{ cid: 'a' }, { cid: 'b' }];
		const next = mark_failed(messages, 'b');
		expect(next).toEqual([{ cid: 'a' }, { cid: 'b', err: true }]);
	});
});
