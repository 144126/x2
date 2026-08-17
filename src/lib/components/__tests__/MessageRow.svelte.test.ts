// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import MessageRow from '../MessageRow.svelte';
import type { Row } from '$lib/msg';

const ME = 'me';
const base: Row = {
	s: 'm',
	id: 'm1',
	c: 'a|b',
	f: 'them',
	t: ME,
	x: 'hello',
	d: 1_700_000_000_000
};

function show(over: Partial<Row> = {}, props: Record<string, unknown> = {}) {
	const onaction = vi.fn();
	render(MessageRow, {
		props: {
			m: { ...base, ...over },
			me: ME,
			mine: false,
			actions: ['reply', 'copy'],
			onaction,
			...props
		}
	});
	return onaction;
}

describe('a deleted message', () => {
	it('says so rather than vanishing, and offers nothing to do', async () => {
		const onaction = show({ dx: 5, x: '' });
		expect(screen.getByText('this message was deleted')).toBeInTheDocument();
		expect(screen.queryByRole('menu')).not.toBeInTheDocument();
		expect(onaction).not.toHaveBeenCalled();
	});
});

describe('the context menu', () => {
	it('opens on a tap and reports the action the caller asked for', async () => {
		const onaction = show();
		await fireEvent.click(screen.getByText('hello'));
		expect(screen.getByRole('menu')).toBeInTheDocument();
		await fireEvent.click(screen.getByText('reply'));
		expect(onaction).toHaveBeenCalledWith('reply', expect.objectContaining({ id: 'm1' }));
	});

	it('shows only the actions it was given', async () => {
		show({}, { actions: ['reply'] });
		await fireEvent.click(screen.getByText('hello'));
		expect(screen.getByText('reply')).toBeInTheDocument();
		expect(screen.queryByText('delete for everyone')).not.toBeInTheDocument();
	});

	it('stays shut while text is being selected', async () => {
		show();
		vi.spyOn(window, 'getSelection').mockReturnValue({ isCollapsed: false } as Selection);
		await fireEvent.click(screen.getByText('hello'));
		expect(screen.queryByRole('menu')).not.toBeInTheDocument();
		vi.restoreAllMocks();
	});
});

describe('view once', () => {
	it('never renders the content, only what kind it was', () => {
		show({ vo: 1, vk: 'i', x: '' });
		expect(screen.getByText('view once photo')).toBeInTheDocument();
		expect(document.querySelector('img')).toBeNull();
	});

	it('marks a spent one as gone', () => {
		show({ vo: 1, vk: 'i', x: '', vd: 99 });
		expect(screen.getByText('photo · opened')).toBeInTheDocument();
	});
});

describe('an attachment in flight', () => {
	it('shows the percentage instead of a preview', () => {
		show({ x: '', up: { pct: 42, st: 'u', name: 'holiday.jpg', size: 2048, type: 'image/jpeg' } });
		expect(screen.getByText('holiday.jpg')).toBeInTheDocument();
		expect(screen.getByText('42%')).toBeInTheDocument();
		expect(document.querySelector('img')).toBeNull();
	});

	it('offers a retry when it failed', async () => {
		const onaction = show({ x: '', err: true });
		await fireEvent.click(screen.getByText('not sent — try again'));
		expect(onaction).toHaveBeenCalledWith('retry', expect.objectContaining({ id: 'm1' }));
	});
});
