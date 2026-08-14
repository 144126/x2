// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/svelte';
import Select from '../Select.svelte';
import SelectHost from './SelectHost.test.svelte';

const options = [
	{ value: 'NG', label: 'Nigeria' },
	{ value: 'GH', label: 'Ghana' }
];

const rows = () => within(screen.getByRole('listbox')).getAllByRole('option');

describe('Select clearing', () => {
	it('offers no clear row while nothing is chosen', async () => {
		render(Select, { props: { value: '', options, placeholder: 'any country' } });
		await fireEvent.click(screen.getByRole('combobox'));
		expect(rows()).toHaveLength(2);
	});

	it('offers a clear row at the top once a value is chosen', async () => {
		render(Select, { props: { value: 'NG', options, placeholder: 'any country' } });
		await fireEvent.click(screen.getByRole('combobox'));
		expect(rows()).toHaveLength(3);
		expect(rows()[0]).toHaveTextContent('any country');
	});

	it('clicking the clear row empties the bound value', async () => {
		render(SelectHost, { props: { options, initial: 'NG' } });
		await fireEvent.click(screen.getByRole('combobox'));
		await fireEvent.click(rows()[0]);
		expect(screen.getByTestId('value').textContent).toBe('');
	});

	it('shows the placeholder on the trigger after clearing', async () => {
		render(SelectHost, { props: { options, initial: 'NG' } });
		await fireEvent.click(screen.getByRole('combobox'));
		await fireEvent.click(rows()[0]);
		expect(screen.getByRole('combobox')).toHaveTextContent('select…');
	});

	it('clicking a real option still commits that option, not its neighbour', async () => {
		render(SelectHost, { props: { options, initial: 'NG' } });
		await fireEvent.click(screen.getByRole('combobox'));
		await fireEvent.click(within(screen.getByRole('listbox')).getByText('Ghana'));
		expect(screen.getByTestId('value').textContent).toBe('GH');
	});

	it('reaches the clear row by keyboard from the top of the list', async () => {
		render(SelectHost, { props: { options, initial: 'GH' } });
		const trigger = screen.getByRole('combobox');
		await fireEvent.keyDown(trigger, { key: 'ArrowDown' });
		await fireEvent.keyDown(trigger, { key: 'Home' });
		await fireEvent.keyDown(trigger, { key: 'Enter' });
		expect(screen.getByTestId('value').textContent).toBe('');
	});

	it('marks the chosen option selected, and never the clear row', async () => {
		render(Select, { props: { value: 'GH', options, placeholder: 'any country' } });
		await fireEvent.click(screen.getByRole('combobox'));
		expect(rows()[0]).toHaveAttribute('aria-selected', 'false');
		expect(within(screen.getByRole('listbox')).getByText('Ghana')).toHaveAttribute(
			'aria-selected',
			'true'
		);
	});
});
