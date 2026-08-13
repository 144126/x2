// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import StickerPicker from '../StickerPicker.svelte';

describe('StickerPicker', () => {
	it('calls onselect with the sticker id when one is clicked', async () => {
		const onselect = vi.fn();
		render(StickerPicker, { props: { onselect } });
		await fireEvent.click(screen.getByTitle('wave'));
		expect(onselect).toHaveBeenCalledWith('wave');
	});

	it('renders each sticker as an image pointing at its served path', () => {
		render(StickerPicker, { props: { onselect: vi.fn() } });
		const img = screen.getByAltText('wave sticker');
		expect(img).toHaveAttribute('src', '/stickers/basics/wave.svg');
	});

	it('filters the grid as the search box is typed', async () => {
		const onselect = vi.fn();
		render(StickerPicker, { props: { onselect } });
		const input = screen.getByPlaceholderText('search stickers…');
		await fireEvent.input(input, { target: { value: 'love' } });
		expect(screen.getByTitle('heart-eyes')).toBeInTheDocument();
		expect(screen.queryByTitle('wave')).toBeNull();
	});
});

describe('StickerPicker — your own stickers', () => {
	it('lists the pack the api returns and sends one as a u: id', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => Response.json({ r: ['img/mine.webp'] }))
		);
		const onselect = vi.fn();
		render(StickerPicker, { props: { onselect } });
		const img = await screen.findByAltText('your sticker');
		expect(img).toHaveAttribute('src', '/media/img/mine.webp');
		await fireEvent.click(img);
		expect(onselect).toHaveBeenCalledWith('u:img/mine.webp');
	});

	it('offers a way to make one from an image', () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => Response.json({ r: [] }))
		);
		render(StickerPicker, { props: { onselect: vi.fn() } });
		expect(screen.getByTitle('make a sticker from an image')).toBeInTheDocument();
	});
});
