<script lang="ts">
	import RadioGroup from '../RadioGroup.svelte';

	let { options, initial = '' }: { options: { value: string; label: string }[]; initial?: string } =
		$props();
	let value = $state(initial);
</script>

<RadioGroup bind:value {options} />
<div data-testid="value">{value}</div>
