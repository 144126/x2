// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import ForwardPicker from '../ForwardPicker.svelte';

const data = {
	conversations: [{ peer: 'bob', last: 100, preview: 'hi', unread: 0 }],
	rooms: [{ id: 'g2', name: 'Design Club' }]
};

describe('ForwardPicker', () => {
	it('renders the combined conversation and room list', () => {
		render(ForwardPicker, { props: { data, onforward: vi.fn(), onclose: vi.fn() } });
		expect(screen.getByText('bob')).toBeInTheDocument();
		expect(screen.getByText('Design Club')).toBeInTheDocument();
	});

	it('select all toggles every checkbox', async () => {
		render(ForwardPicker, { props: { data, onforward: vi.fn(), onclose: vi.fn() } });
		await fireEvent.click(screen.getByRole('button', { name: 'select all' }));
		const checkboxes = screen.getAllByRole('checkbox');
		expect(checkboxes.every((c) => c.checked)).toBe(true);
		await fireEvent.click(screen.getByRole('button', { name: 'select all' }));
		expect(screen.getAllByRole('checkbox').every((c) => !c.checked)).toBe(true);
	});

	it('forward button is disabled with zero selections', () => {
		render(ForwardPicker, { props: { data, onforward: vi.fn(), onclose: vi.fn() } });
		expect(screen.getByRole('button', { name: 'forward to' })).toBeDisabled();
	});

	it('calls onforward with {to}/{group} shaped targets for the selections', async () => {
		const onforward = vi.fn();
		render(ForwardPicker, { props: { data, onforward, onclose: vi.fn() } });
		await fireEvent.click(screen.getByLabelText('Design Club'));
		await fireEvent.click(screen.getByLabelText('bob'));
		await fireEvent.click(screen.getByRole('button', { name: 'forward to 2' }));
		expect(onforward).toHaveBeenCalledWith([{ group: 'g2' }, { to: 'bob' }]);
	});
});
