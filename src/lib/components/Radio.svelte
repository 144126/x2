<script lang="ts">
	let {
		checked = false,
		label,
		tabindex = -1,
		onselect,
		onkeydown
	}: {
		checked?: boolean;
		label: string;
		tabindex?: number;
		onselect?: () => void;
		onkeydown?: (e: KeyboardEvent) => void;
	} = $props();
</script>

<span
	role="radio"
	aria-checked={checked}
	{tabindex}
	class="card flex cursor-pointer items-center gap-3 px-4 py-3"
	onclick={onselect}
	onkeydown={(e) => {
		if (e.key === ' ' || e.key === 'Enter') {
			e.preventDefault();
			onselect?.();
		}
		onkeydown?.(e);
	}}
>
	<span
		class="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border transition-colors duration-300 {checked
			? 'border-accent'
			: 'border-line-2'}"
	>
		{#if checked}
			<span class="h-[9px] w-[9px] rounded-full bg-accent"></span>
		{/if}
	</span>
	<span>{label}</span>
</span>
