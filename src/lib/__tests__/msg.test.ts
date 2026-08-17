import { describe, it, expect } from 'vitest';
import {
	pending,
	failed,
	deleted,
	burnt,
	openable,
	label,
	size_of,
	human_size,
	has_attachment,
	type Row
} from '../msg';

const ME = 'me';
const base: Row = { s: 'm', id: 'm1', c: 'a|b', f: 'them', t: ME, x: '', d: 1 };
const row = (over: Partial<Row> = {}): Row => ({ ...base, ...over });
const file = { key: 'k', name: 'notes.pdf', size: 2048, type: 'application/pdf' };

describe('in-flight state', () => {
	it('is pending while bytes are moving and not once they stopped', () => {
		expect(
			pending(row({ up: { pct: 40, st: 'u', name: 'a.png', size: 1, type: 'image/png' } }))
		).toBe(true);
		expect(
			pending(row({ up: { pct: 100, st: 's', name: 'a.png', size: 1, type: 'image/png' } }))
		).toBe(true);
		expect(
			pending(row({ up: { pct: 12, st: 'e', name: 'a.png', size: 1, type: 'image/png' } }))
		).toBe(false);
		expect(pending(row())).toBe(false);
	});

	it('counts a stopped upload and a failed send as the same failure', () => {
		expect(
			failed(row({ up: { pct: 12, st: 'e', name: 'a.png', size: 1, type: 'image/png' } }))
		).toBe(true);
		expect(failed(row({ err: true }))).toBe(true);
		expect(failed(row())).toBe(false);
	});
});

describe('view once', () => {
	it('is burnt for a reader who already looked', () => {
		expect(burnt(row({ vo: 1, vk: 'i', vw: [ME] }), ME)).toBe(true);
		expect(burnt(row({ vo: 1, vk: 'i', vw: ['someone'] }), ME)).toBe(false);
	});

	it('is burnt for everyone once the content was destroyed', () => {
		expect(burnt(row({ vo: 1, vk: 'i', vd: 123 }), ME)).toBe(true);
	});

	it('is never burnt when the message is not view once', () => {
		expect(burnt(row({ im: 'k' }), ME)).toBe(false);
	});

	it('cannot be opened by the person who sent it', () => {
		expect(openable(row({ vo: 1, vk: 'i', f: ME }), ME)).toBe(false);
	});

	it('can be opened once by the recipient, and never again', () => {
		const r = row({ vo: 1, vk: 'i' });
		expect(openable(r, ME)).toBe(true);
		expect(openable({ ...r, vw: [ME] }, ME)).toBe(false);
	});

	it('says what kind it was before, and that it is spent after', () => {
		expect(label(row({ vo: 1, vk: 'i' }), ME)).toBe('view once photo');
		expect(label(row({ vo: 1, vk: 'a' }), ME)).toBe('view once voice note');
		expect(label(row({ vo: 1, vk: 'i', vd: 1 }), ME)).toBe('photo · opened');
	});
});

describe('what can be opened at all', () => {
	it('opens ordinary media, and nothing that is still moving or broken', () => {
		expect(openable(row({ im: 'k' }), ME)).toBe(true);
		expect(openable(row({ fl: file }), ME)).toBe(true);
		expect(openable(row({ x: 'just words' }), ME)).toBe(false);
		expect(openable(row({ fl: file, err: true }), ME)).toBe(false);
		expect(openable(row({ dx: 99 }), ME)).toBe(false);
	});
});

describe('labels', () => {
	it('prefers a real filename', () => {
		expect(label(row({ fl: file }), ME)).toBe('notes.pdf');
		expect(label(row({ im: 'k' }), ME)).toBe('photo');
	});

	it('uses the local name while the file is still uploading', () => {
		expect(
			label(row({ up: { pct: 3, st: 'u', name: 'holiday.jpg', size: 9, type: 'image/jpeg' } }), ME)
		).toBe('holiday.jpg');
	});

	it('sizes read the way a person would say them', () => {
		expect(human_size(512)).toBe('512b');
		expect(human_size(2048)).toBe('2kb');
		expect(human_size(3 * 1024 * 1024)).toBe('3.0mb');
		expect(size_of(row({ fl: file }))).toBe('2kb');
		expect(size_of(row())).toBe('');
	});
});

describe('misc', () => {
	it('knows a tombstone', () => {
		expect(deleted(row({ dx: 5 }))).toBe(true);
		expect(deleted(row())).toBe(false);
	});

	it('knows when a row carries something other than text', () => {
		expect(has_attachment(row({ im: 'k' }))).toBe(true);
		expect(has_attachment(row({ vo: 1, vk: 't' }))).toBe(true);
		expect(has_attachment(row({ x: 'hi' }))).toBe(false);
	});
});
