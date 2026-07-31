<script lang="ts">
	import { EMOJIS, GROUPS, search_emoji } from '$lib/emoji';
	let { onselect, onclose }: { onselect: (emoji: string) => void; onclose: () => void } = $props();
	let q = $state('');
	let activeGroup = $state<number | null>(null);
	let results = $derived(
		q.trim()
			? search_emoji(q)
			: activeGroup === null
				? EMOJIS
				: EMOJIS.filter((e) => e.group === activeGroup)
	);
</script>

<div
	class="flex w-[300px] flex-col rounded-[14px] border border-line bg-panel-solid p-3 shadow-lg"
	role="dialog"
>
	<input class="mb-2 text-[13px]" placeholder="search emoji…" bind:value={q} />
	{#if !q.trim()}
		<div class="mb-2 flex gap-1 overflow-x-auto">
			<button
				type="button"
				class="btn px-2 py-1 text-[11px]"
				class:btn-amber={activeGroup === null}
				onclick={() => (activeGroup = null)}
				>all</button
			>
			{#each GROUPS as g (g.key)}
				<button
					type="button"
					class="btn shrink-0 px-2 py-1 text-[11px]"
					class:btn-amber={activeGroup === g.key}
					onclick={() => (activeGroup = g.key)}
					>{g.label}</button
				>
			{/each}
		</div>
	{/if}
	<div class="grid max-h-[240px] grid-cols-8 gap-1 overflow-y-auto">
		{#each results as e (e.emoji)}
			<button
				type="button"
				class="rounded-[6px] p-1 text-[20px] hover:bg-panel"
				title={e.label}
				onclick={() => onselect(e.emoji)}
				>{e.emoji}</button
			>
		{/each}
	</div>
</div>
