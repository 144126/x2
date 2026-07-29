import { describe, it, expect } from 'vitest';
import { reply_body } from '../sw-core';

describe('reply_body', () => {
	it('replies to a room by group id', () => {
		expect(reply_body({ kind: 'r', reply_to: 'r1' }, 'hello')).toEqual({
			group: 'r1',
			text: 'hello'
		});
	});

	it('replies to a person by uid', () => {
		expect(reply_body({ kind: 'u', reply_to: 'bob' }, 'hi')).toEqual({
			to: 'bob',
			text: 'hi'
		});
	});

	it('returns null without a reply target, rather than guessing', () => {
		expect(reply_body({ kind: 'u' }, 'hi')).toBeNull();
		expect(reply_body(null, 'hi')).toBeNull();
	});

	it('returns null for empty reply text', () => {
		expect(reply_body({ kind: 'u', reply_to: 'bob' }, '')).toBeNull();
		expect(reply_body({ kind: 'u', reply_to: 'bob' }, '  ')).toBeNull();
	});
});
