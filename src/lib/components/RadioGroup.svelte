<script lang="ts">
	import Radio from './Radio.svelte';

	type Option = { value: string; label: string };

	let {
		value = $bindable(''),
		options
	}: {
		value?: string;
		options: Option[];
	} = $props();

	let checked_index = $derived(options.findIndex((o) => o.value === value));
	// roving tabindex: the checked option, or the first when nothing is checked yet
	let roving_index = $derived(checked_index >= 0 ? checked_index : 0);

	function select(i: number) {
		value = options[i].value;
	}

	function on_keydown(i: number, e: KeyboardEvent) {
		if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
			e.preventDefault();
			select(Math.min(i + 1, options.length - 1));
		} else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
			e.preventDefault();
			select(Math.max(i - 1, 0));
		} else if (e.key === 'Home') {
			e.preventDefault();
			select(0);
		} else if (e.key === 'End') {
			e.preventDefault();
			select(options.length - 1);
		}
	}
</script>

<div role="radiogroup" class="flex flex-col gap-2.5">
	{#each options as o, i (o.value)}
		<Radio
			label={o.label}
			checked={o.value === value}
			tabindex={i === roving_index ? 0 : -1}
			onselect={() => select(i)}
			onkeydown={(e) => on_keydown(i, e)}
		/>
	{/each}
</div>
