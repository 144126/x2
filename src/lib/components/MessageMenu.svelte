<script lang="ts">
	import type { Item } from '$lib/msg';

	let {
		rect,
		items,
		onpick,
		onclose
	}: { rect: DOMRect; items: Item[]; onpick: (id: string) => void; onclose: () => void } = $props();

	const W = 176;
	const ROW = 34;
	const PAD = 8;

	let h = $derived(items.length * ROW + PAD);
	// below the bubble by default, above it when that would run off the bottom
	let top = $derived(
		rect.bottom + h + PAD > innerHeight ? Math.max(PAD, rect.top - h - 4) : rect.bottom + 4
	);
	let left = $derived(Math.min(Math.max(PAD, rect.left), innerWidth - W - PAD));
</script>

<svelte:window
	onkeydown={(e) => e.key === 'Escape' && onclose()}
	onscroll={onclose}
	onresize={onclose}
/>

<!-- a transparent sheet, so the next tap anywhere dismisses instead of acting -->
<div
	class="fixed inset-0 z-40"
	role="presentation"
	onpointerdown={onclose}
	oncontextmenu={(e) => (e.preventDefault(), onclose())}
></div>

<div
	class="fixed z-50 flex flex-col overflow-hidden rounded-[12px] border border-line-2 bg-panel-solid py-1 shadow-lg"
	style:top="{top}px"
	style:left="{left}px"
	style:width="{W}px"
	role="menu"
	tabindex="-1"
>
	{#each items as it (it.id)}
		<button
			type="button"
			role="menuitem"
			class="flex items-center gap-2.5 px-3 py-2 text-left text-[13px] transition-colors duration-150 hover:bg-accent-soft {it.danger
				? 'text-danger'
				: 'text-ink'}"
			onclick={() => (onpick(it.id), onclose())}
		>
			{#if it.icon}{@const Icon = it.icon}<Icon size={14} class="shrink-0 opacity-70" />{/if}
			{it.label}
		</button>
	{/each}
</div>
