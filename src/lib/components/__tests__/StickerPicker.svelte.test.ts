// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import StickerPicker from '../StickerPicker.svelte';

describe('StickerPicker', () => {
	it('calls onselect with the sticker id when one is clicked', async () => {
		const onselect = vi.fn();
		render(StickerPicker, { props: { onselect, onclose: vi.fn() } });
		await fireEvent.click(screen.getByTitle('wave'));
		expect(onselect).toHaveBeenCalledWith('wave');
	});

	it('renders each sticker as an image pointing at its served path', () => {
		render(StickerPicker, { props: { onselect: vi.fn(), onclose: vi.fn() } });
		const img = screen.getByAltText('wave sticker');
		expect(img).toHaveAttribute('src', '/stickers/basics/wave.webp');
	});

	it('filters the grid as the search box is typed', async () => {
		const onselect = vi.fn();
		render(StickerPicker, { props: { onselect, onclose: vi.fn() } });
		const input = screen.getByPlaceholderText('search stickers…');
		await fireEvent.input(input, { target: { value: 'love' } });
		expect(screen.getByTitle('heart-eyes')).toBeInTheDocument();
		expect(screen.queryByTitle('wave')).toBeNull();
	});
});
