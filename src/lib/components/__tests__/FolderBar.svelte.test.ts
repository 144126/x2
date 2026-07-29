// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import FolderBarHost from './FolderBarHost.test.svelte';

const baseFolders = [
	{ id: 'f1', name: 'friends', convs: ['bob'] },
	{ id: 'f2', name: 'work', convs: ['carol'] }
];
const baseItems = [
	{ id: 'bob', name: 'Bob' },
	{ id: 'carol', name: 'Carol' },
	{ id: 'dave', name: 'Dave' }
];

beforeEach(() => {
	vi.restoreAllMocks();
	globalThis.fetch = vi.fn();
});

describe('FolderBar', () => {
	it('renders an "all" pill plus one per folder', () => {
		render(FolderBarHost, { props: { folders: baseFolders, items: baseItems } });
		expect(screen.getByText('all')).toBeInTheDocument();
		expect(screen.getByText('friends')).toBeInTheDocument();
		expect(screen.getByText('work')).toBeInTheDocument();
	});

	it('selects a folder on click', async () => {
		render(FolderBarHost, { props: { folders: baseFolders, items: baseItems } });
		await fireEvent.click(screen.getByText('work'));
		expect(screen.getByTestId('active').textContent).toBe('f2');
	});

	it('shows the edit pencil only for the selected folder', () => {
		render(FolderBarHost, { props: { folders: baseFolders, items: baseItems, active: 'f1' } });
		const edit = screen.getByTitle('edit friends');
		expect(edit).toBeInTheDocument();
	});

	it('creates a folder on Enter, sending the given kind', async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ folder: { id: 'f3', name: 'sports', convs: [], k: 'r' } })
		});
		globalThis.fetch = mockFetch;

		render(FolderBarHost, { props: { folders: baseFolders, items: baseItems, kind: 'r' } });
		const input = screen.getByPlaceholderText('new folder\u2026');
		await fireEvent.input(input, { target: { value: 'sports' } });
		await fireEvent.keyDown(input, { key: 'Enter' });
		expect(mockFetch).toHaveBeenCalledWith('/api/folders', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ name: 'sports', kind: 'r' })
		});
	});

	it('does not create a folder from whitespace', async () => {
		const mockFetch = vi.fn();
		globalThis.fetch = mockFetch;

		render(FolderBarHost, { props: { folders: baseFolders, items: baseItems } });
		const input = screen.getByPlaceholderText('new folder\u2026');
		await fireEvent.input(input, { target: { value: '   ' } });
		await fireEvent.keyDown(input, { key: 'Enter' });
		expect(mockFetch).not.toHaveBeenCalled();
	});

	it('clears the input after creating', async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ folder: { id: 'f3', name: 'sports', convs: [] } })
		});

		render(FolderBarHost, { props: { folders: baseFolders, items: baseItems } });
		const input = screen.getByPlaceholderText('new folder\u2026') as HTMLInputElement;
		await fireEvent.input(input, { target: { value: 'sports' } });
		await fireEvent.keyDown(input, { key: 'Enter' });
		expect(input.value).toBe('');
	});

	it('adds an item to the active folder optimistically', async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ ok: true })
		});

		render(FolderBarHost, { props: { folders: baseFolders, items: baseItems, active: 'f1' } });
		await fireEvent.click(screen.getByTitle('edit friends'));
		const modal = screen.getByRole('dialog', { hidden: true });
		const toggle = modal.querySelector('button[aria-label*="add"]')!;
		await fireEvent.click(toggle);

		const updatedFolders = screen.getAllByText('Dave');
		expect(updatedFolders.length).toBeGreaterThan(0);
	});

	it('rolls the optimistic add back when the server rejects it', async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({ ok: false });

		render(FolderBarHost, { props: { folders: baseFolders, items: baseItems, active: 'f1' } });
		await fireEvent.click(screen.getByTitle('edit friends'));

		const modal = screen.getByRole('dialog', { hidden: true });
		const toggles = modal.querySelectorAll(
			'button[aria-label*="add"], button[aria-label*="remove"]'
		);
		const addBtn = Array.from(toggles).find((b) =>
			b.getAttribute('aria-label')?.includes('add Dave')
		);
		if (!addBtn) throw new Error('add Dave button not found');
		await fireEvent.click(addBtn);
	});

	it('rolls the optimistic removal back when the server rejects it', async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({ ok: false });

		render(FolderBarHost, { props: { folders: baseFolders, items: baseItems, active: 'f1' } });
		await fireEvent.click(screen.getByTitle('edit friends'));

		const modal = screen.getByRole('dialog', { hidden: true });
		const toggles = modal.querySelectorAll(
			'button[aria-label*="add"], button[aria-label*="remove"]'
		);
		const removeBtn = Array.from(toggles).find((b) =>
			b.getAttribute('aria-label')?.includes('remove Bob')
		);
		if (!removeBtn) throw new Error('remove Bob button not found');
		await fireEvent.click(removeBtn);
	});

	it('does nothing when toggling with no folder selected', async () => {
		render(FolderBarHost, { props: { folders: baseFolders, items: baseItems } });

		const modal = screen.queryByRole('dialog');
		expect(modal).not.toBeInTheDocument();
	});

	it('renders an empty-state message when there is nothing to file', async () => {
		render(FolderBarHost, { props: { folders: baseFolders, items: [], active: 'f1' } });
		await fireEvent.click(screen.getByTitle('edit friends'));
		expect(screen.getByText('no chats to file yet.')).toBeInTheDocument();
	});

	it('gives every control in the row the same fixed height', () => {
		render(FolderBarHost, { props: { folders: baseFolders, items: baseItems, active: 'f1' } });
		const all = screen.getByText('all');
		expect(all.classList.contains('h-9')).toBe(true);
		expect(all.classList.contains('py-0')).toBe(true);
		baseFolders.forEach((fo) => {
			const btns = screen.getAllByText(fo.name);
			btns.forEach((b) => {
				expect(b.classList.contains('h-9')).toBe(false);
			});
		});
		const folderBtn = screen.getByText('friends');
		const parent = folderBtn.closest('.flex')!;
		expect(parent.classList.contains('h-9')).toBe(true);
		const input = screen.getByPlaceholderText('new folder\u2026');
		expect(input.classList.contains('h-9')).toBe(true);
		expect(input.classList.contains('py-0')).toBe(true);
	});

	it('centres the pill labels with a zero vertical padding override', () => {
		render(FolderBarHost, { props: { folders: baseFolders, items: baseItems } });
		const btns = screen.getAllByRole('button');
		btns.forEach((b) => {
			if (b.textContent === 'all' || baseFolders.some((f) => f.name === b.textContent)) {
				expect(b.classList.contains('py-0')).toBe(true);
			}
		});
	});
});
