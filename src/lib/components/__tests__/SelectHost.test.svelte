<script lang="ts">
	import Select from '../Select.svelte';

	let { options, initial = '' }: { options: { value: string; label: string }[]; initial?: string } =
		$props();
	let value = $state(initial);
</script>

<Select bind:value {options} />
<div data-testid="value">{value}</div>
