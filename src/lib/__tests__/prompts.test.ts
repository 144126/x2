import { describe, it, expect } from 'vitest';
import { questions_for, SKIP_LOCK_MS, WRAP_AFTER_MS } from '../prompts';

describe('questions_for', () => {
	it('gives both people in a conversation the same three questions', () => {
		// the two clients never talk to each other about this — identical output is the
		// only thing that makes a shared question possible
		expect(questions_for('a|b')).toEqual(questions_for('a|b'));
		expect(questions_for('a|b')).toHaveLength(3);
	});

	it('escalates rather than repeating one tier', () => {
		const q = questions_for('a|b');
		expect(new Set(q).size).toBe(3);
	});

	it('ends on a question about the two of them, not a topic', () => {
		for (const conv of ['a|b', 'x|y', 'p|q', '1|2', 'zz|aa']) {
			expect(questions_for(conv)[2]).toMatch(/\b(me|we|i|you)\b/);
		}
	});

	it('varies across conversations', () => {
		const seen = new Set(
			Array.from({ length: 40 }, (_, i) => questions_for(`c${i}|d${i}`).join('|'))
		);
		expect(seen.size).toBeGreaterThan(10);
	});

	it('protects the opening minute but not longer', () => {
		expect(SKIP_LOCK_MS).toBe(60_000);
		expect(WRAP_AFTER_MS).toBeGreaterThan(SKIP_LOCK_MS);
	});
});
