// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import RadioGroupHost from './RadioGroupHost.test.svelte';

const options = [
	{ value: 'text', label: 'text only' },
	{ value: 'voice', label: 'voice + text' },
	{ value: 'video', label: 'video + text' }
];

describe('RadioGroup', () => {
	it('renders one radio per option, exactly one checked matching value', () => {
		render(RadioGroupHost, { props: { options, initial: 'voice' } });
		const radios = screen.getAllByRole('radio');
		expect(radios).toHaveLength(3);
		expect(radios.filter((r) => r.getAttribute('aria-checked') === 'true')).toHaveLength(1);
		expect(screen.getByText('voice + text').closest('[role="radio"]')).toHaveAttribute(
			'aria-checked',
			'true'
		);
	});

	it('clicking an unselected option selects it', async () => {
		render(RadioGroupHost, { props: { options, initial: 'voice' } });
		await fireEvent.click(screen.getByText('text only'));
		expect(screen.getByTestId('value').textContent).toBe('text');
	});

	it('ArrowDown selects the next option and clamps at the last', async () => {
		render(RadioGroupHost, { props: { options, initial: 'voice' } });
		const checked = screen.getByText('voice + text').closest('[role="radio"]')!;
		await fireEvent.keyDown(checked, { key: 'ArrowDown' });
		expect(screen.getByTestId('value').textContent).toBe('video');
		const nowChecked = screen.getByText('video + text').closest('[role="radio"]')!;
		await fireEvent.keyDown(nowChecked, { key: 'ArrowDown' });
		expect(screen.getByTestId('value').textContent).toBe('video');
	});

	it('ArrowUp selects the previous option and clamps at the first', async () => {
		render(RadioGroupHost, { props: { options, initial: 'voice' } });
		const checked = screen.getByText('voice + text').closest('[role="radio"]')!;
		await fireEvent.keyDown(checked, { key: 'ArrowUp' });
		expect(screen.getByTestId('value').textContent).toBe('text');
		const nowChecked = screen.getByText('text only').closest('[role="radio"]')!;
		await fireEvent.keyDown(nowChecked, { key: 'ArrowUp' });
		expect(screen.getByTestId('value').textContent).toBe('text');
	});

	it('Home selects the first option, End selects the last', async () => {
		render(RadioGroupHost, { props: { options, initial: 'voice' } });
		const checked = screen.getByText('voice + text').closest('[role="radio"]')!;
		await fireEvent.keyDown(checked, { key: 'Home' });
		expect(screen.getByTestId('value').textContent).toBe('text');
		const nowChecked = screen.getByText('text only').closest('[role="radio"]')!;
		await fireEvent.keyDown(nowChecked, { key: 'End' });
		expect(screen.getByTestId('value').textContent).toBe('video');
	});

	it('gives only the checked option (or the first, if none checked) tabindex 0', () => {
		render(RadioGroupHost, { props: { options, initial: 'voice' } });
		expect(screen.getByText('text only').closest('[role="radio"]')).toHaveAttribute(
			'tabindex',
			'-1'
		);
		expect(screen.getByText('voice + text').closest('[role="radio"]')).toHaveAttribute(
			'tabindex',
			'0'
		);
		expect(screen.getByText('video + text').closest('[role="radio"]')).toHaveAttribute(
			'tabindex',
			'-1'
		);
	});

	it('defaults roving tabindex to the first option when nothing is checked', () => {
		render(RadioGroupHost, { props: { options, initial: '' } });
		expect(screen.getByText('text only').closest('[role="radio"]')).toHaveAttribute(
			'tabindex',
			'0'
		);
	});
});
