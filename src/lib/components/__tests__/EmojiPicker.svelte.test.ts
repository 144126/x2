// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import EmojiPicker from '../EmojiPicker.svelte';

describe('EmojiPicker', () => {
	it('calls onselect with the emoji character when one is clicked', async () => {
		const onselect = vi.fn();
		render(EmojiPicker, { props: { onselect, onclose: vi.fn() } });
		const grinning = screen.getByTitle('grinning face');
		await fireEvent.click(grinning);
		expect(onselect).toHaveBeenCalledWith('😀');
	});

	it('filters the grid as the search box is typed', async () => {
		const onselect = vi.fn();
		render(EmojiPicker, { props: { onselect, onclose: vi.fn() } });
		const input = screen.getByPlaceholderText('search emoji…');
		await fireEvent.input(input, { target: { value: 'teeth' } });
		expect(screen.getByTitle('grinning face')).toBeInTheDocument();
		expect(screen.queryByTitle('grinning face with sweat')).toBeNull();
		expect(screen.getByTitle('beaming face with smiling eyes')).toBeInTheDocument();
	});

	it('category tabs narrow the grid to one group', { timeout: 20000 }, async () => {
		const onselect = vi.fn();
		render(EmojiPicker, { props: { onselect, onclose: vi.fn() } });
		expect(screen.getByTitle('red apple')).toBeInTheDocument();
		await fireEvent.click(screen.getByRole('button', { name: /smileys/i }));
		expect(screen.getByTitle('grinning face')).toBeInTheDocument();
		expect(screen.queryByTitle('red apple')).toBeNull();
		await fireEvent.click(screen.getByRole('button', { name: /food/i }));
		expect(screen.getByTitle('red apple')).toBeInTheDocument();
	});

	it('shows category tabs only when the search box is empty', async () => {
		render(EmojiPicker, { props: { onselect: vi.fn(), onclose: vi.fn() } });
		expect(screen.getByRole('button', { name: 'all' })).toBeInTheDocument();
		const input = screen.getByPlaceholderText('search emoji…');
		await fireEvent.input(input, { target: { value: 'teeth' } });
		expect(screen.queryByRole('button', { name: 'all' })).toBeNull();
	});
});
