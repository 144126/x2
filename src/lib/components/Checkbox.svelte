<script lang="ts">
	import { Check } from '@lucide/svelte';
	import type { Snippet } from 'svelte';

	// a toggle that acts the moment you click it, so it is a pressed button rather than a
	// checkbox waiting on a submit. `indicator` replaces the tick for toggles that show
	// state some other way, like the pulsing dot on "online now".
	let {
		checked = $bindable(false),
		label,
		class: klass = '',
		indicator,
		onchange
	}: {
		checked?: boolean;
		label: string;
		class?: string;
		indicator?: Snippet<[boolean]>;
		onchange?: (checked: boolean) => void;
	} = $props();

	function toggle() {
		checked = !checked;
		onchange?.(checked);
	}
</script>

<button
	type="button"
	aria-pressed={checked}
	onclick={toggle}
	class="flex cursor-pointer items-center gap-2 text-left {klass}"
>
	{#if indicator}
		{@render indicator(checked)}
	{:else}
		<span
			class="grid h-[15px] w-[15px] shrink-0 place-items-center rounded-[5px] border transition-colors duration-300 {checked
				? 'border-accent bg-accent text-accent-ink'
				: 'border-line-2'}"
		>
			{#if checked}<Check size={10} strokeWidth={3.5} />{/if}
		</span>
	{/if}
	{label}
</button>
