// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/svelte';
import Select from '../Select.svelte';
import SelectHost from './SelectHost.test.svelte';

const options = [
	{ value: 'm', label: 'male' },
	{ value: 'f', label: 'female' },
	{ value: 'o', label: 'other' }
];

describe('Select', () => {
	it('shows the placeholder when value matches no option', () => {
		render(Select, { props: { value: '', options, placeholder: 'any gender' } });
		expect(screen.getByRole('combobox')).toHaveTextContent('any gender');
	});

	it('shows the matching option label when value is set', () => {
		render(Select, { props: { value: 'f', options, placeholder: 'any gender' } });
		expect(screen.getByRole('combobox')).toHaveTextContent('female');
	});

	it('opens the listbox on trigger click', async () => {
		render(Select, { props: { value: '', options } });
		const trigger = screen.getByRole('combobox');
		expect(trigger).toHaveAttribute('aria-expanded', 'false');
		await fireEvent.click(trigger);
		expect(trigger).toHaveAttribute('aria-expanded', 'true');
		expect(screen.getByRole('listbox')).toBeTruthy();
	});

	it('passes an aria-label through to the trigger', () => {
		render(Select, { props: { value: '', options, 'aria-label': 'gender' } });
		expect(screen.getByRole('combobox', { name: 'gender' })).toBeTruthy();
	});

	it('clicking an option commits it to the bound value and closes the list', async () => {
		render(SelectHost, { props: { options, initial: '' } });
		await fireEvent.click(screen.getByRole('combobox'));
		await fireEvent.click(screen.getByText('female'));
		expect(screen.getByTestId('value').textContent).toBe('f');
		expect(screen.queryByRole('listbox')).toBeNull();
	});

	it('ArrowDown on the closed trigger opens it and highlights the current value', async () => {
		render(SelectHost, { props: { options, initial: 'f' } });
		const trigger = screen.getByRole('combobox');
		await fireEvent.keyDown(trigger, { key: 'ArrowDown' });
		expect(trigger).toHaveAttribute('aria-expanded', 'true');
		const female = within(screen.getByRole('listbox')).getByText('female').closest('[role="option"]')!;
		expect(female).toHaveAttribute('aria-selected', 'true');
	});

	it('ArrowDown/ArrowUp inside the open list move highlight without changing value until committed', async () => {
		render(SelectHost, { props: { options, initial: '' } });
		const trigger = screen.getByRole('combobox');
		await fireEvent.click(trigger);
		await fireEvent.keyDown(trigger, { key: 'ArrowDown' });
		await fireEvent.keyDown(trigger, { key: 'ArrowDown' });
		expect(screen.getByTestId('value').textContent).toBe('');
		const listbox = screen.getByRole('listbox');
		const highlighted = screen.getByText('female').closest('[role="option"]')!;
		expect(listbox).toHaveAttribute('aria-activedescendant', highlighted.id);
	});

	it('Enter commits the highlighted option and closes', async () => {
		render(SelectHost, { props: { options, initial: '' } });
		const trigger = screen.getByRole('combobox');
		await fireEvent.click(trigger);
		await fireEvent.keyDown(trigger, { key: 'ArrowDown' });
		await fireEvent.keyDown(trigger, { key: 'Enter' });
		expect(screen.getByTestId('value').textContent).toBe('m');
		expect(screen.queryByRole('listbox')).toBeNull();
	});

	it('Escape closes without changing value', async () => {
		render(SelectHost, { props: { options, initial: 'o' } });
		const trigger = screen.getByRole('combobox');
		await fireEvent.click(trigger);
		await fireEvent.keyDown(trigger, { key: 'ArrowDown' });
		await fireEvent.keyDown(trigger, { key: 'Escape' });
		expect(screen.getByTestId('value').textContent).toBe('o');
		expect(screen.queryByRole('listbox')).toBeNull();
	});

	it('Home/End jump highlight to first/last option', async () => {
		render(SelectHost, { props: { options, initial: '' } });
		const trigger = screen.getByRole('combobox');
		await fireEvent.click(trigger);
		await fireEvent.keyDown(trigger, { key: 'End' });
		await fireEvent.keyDown(trigger, { key: 'Enter' });
		expect(screen.getByTestId('value').textContent).toBe('o');
	});

	it('typing a letter jumps highlight to the next option starting with it', async () => {
		render(SelectHost, { props: { options, initial: '' } });
		const trigger = screen.getByRole('combobox');
		await fireEvent.click(trigger);
		await fireEvent.keyDown(trigger, { key: 'o' });
		await fireEvent.keyDown(trigger, { key: 'Enter' });
		expect(screen.getByTestId('value').textContent).toBe('o');
	});

	it('clicking outside the open listbox closes it without changing value', async () => {
		render(SelectHost, { props: { options, initial: '' } });
		const trigger = screen.getByRole('combobox');
		await fireEvent.click(trigger);
		await fireEvent.click(document.body);
		expect(screen.queryByRole('listbox')).toBeNull();
		expect(screen.getByTestId('value').textContent).toBe('');
	});
});
