import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import ModalHost from './ModalHost.test.svelte';
import ModalWideHost from './ModalWideHost.test.svelte';

// jsdom implements <dialog>, but guard so the suite fails loudly rather than mysteriously
beforeAll(() => {
	if (typeof HTMLDialogElement === 'undefined') throw new Error('jsdom lacks <dialog> support');
});

describe('Modal', () => {
	it('stays closed until `open` is set', () => {
		render(ModalHost, { props: { open: false } });
		expect((screen.getByRole('dialog', { hidden: true }) as HTMLDialogElement).open).toBe(false);
	});

	it('opens as a modal dialog and renders its title and children', async () => {
		render(ModalHost, { props: { open: true } });
		const dialog = screen.getByRole('dialog') as HTMLDialogElement;
		expect(dialog.open).toBe(true);
		expect(screen.getByText('edit folder')).toBeInTheDocument();
		expect(screen.getByText('modal body')).toBeInTheDocument();
	});

	it('closes when the close button is pressed', async () => {
		render(ModalHost, { props: { open: true } });
		const dialog = screen.getByRole('dialog') as HTMLDialogElement;
		screen.getByRole('button', { name: 'close' }).click();
		await new Promise((r) => setTimeout(r, 0));
		expect(dialog.open).toBe(false);
	});

	it('opens at near-fullscreen when wide', () => {
		const { container } = render(ModalWideHost, { props: { open: true } });
		const html = container.innerHTML;
		expect(html).toContain('h-[92dvh]');
		expect(html).toContain('w-[min(920px,96vw)]');
	});
});
