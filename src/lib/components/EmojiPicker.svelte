<script lang="ts">
	import { onMount } from 'svelte';
	import { EMOJIS, GROUPS, search_emoji } from '$lib/emoji';
	let { onselect, onclose }: { onselect: (emoji: string) => void; onclose: () => void } = $props();
	let q = $state('');
	let activeGroup = $state<number | null>(null);
	let recent = $state<string[]>([]);
	const RECENT_KEY = 'x2:recent_emojis';
	const RECENT_MAX = 12;

	function load_recent(): string[] {
		const raw = localStorage.getItem(RECENT_KEY);
		if (!raw) return [];
		try {
			return JSON.parse(raw);
		} catch {
			return [];
		}
	}

	onMount(() => {
		recent = load_recent();
	});

	function pick(e: string) {
		recent = [e, ...recent.filter((x) => x !== e)].slice(0, RECENT_MAX);
		try {
			localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
		} catch {
			return;
		}
		onselect(e);
	}

	const label_of = (e: string): string => EMOJIS.find((x) => x.emoji === e)?.label ?? e;
	const searching = $derived(q.trim() !== '');
	const results = $derived(
		searching
			? search_emoji(q)
			: activeGroup === null
				? EMOJIS
				: EMOJIS.filter((e) => e.group === activeGroup)
	);
	const sections = $derived(
		searching || activeGroup !== null
			? []
			: GROUPS.map((g) => ({ ...g, emojis: EMOJIS.filter((e) => e.group === g.key) }))
	);
</script>

<div
	class="flex w-full flex-col rounded-[14px] border border-line bg-panel-solid p-3 shadow-lg"
	role="dialog"
>
	<input autofocus class="mb-2 text-[13px]" placeholder="search emoji…" bind:value={q} />
	{#if !searching && recent.length}
		<div class="mb-2">
			<div class="mb-1 text-[10.5px] uppercase tracking-[0.16em] text-mute">recent</div>
			<div class="grid grid-cols-12 gap-1">
				{#each recent as e (e)}
					<button
						type="button"
						class="rounded-[6px] p-1 text-[22px] hover:bg-panel"
						aria-label={'recent ' + label_of(e)}
						onclick={() => pick(e)}>{e}</button
					>
				{/each}
			</div>
		</div>
	{/if}
	{#if !searching}
		<div class="mb-2 flex gap-1 overflow-x-auto">
			<button
				type="button"
				class="btn px-2 py-1 text-[11px]"
				class:btn-amber={activeGroup === null}
				onclick={() => (activeGroup = null)}>all</button
			>
			{#each GROUPS as g (g.key)}
				<button
					type="button"
					class="btn shrink-0 px-2 py-1 text-[11px]"
					class:btn-amber={activeGroup === g.key}
					onclick={() => (activeGroup = g.key)}>{g.label}</button
				>
			{/each}
		</div>
	{/if}
	<div class="max-h-[min(60dvh,480px)] overflow-y-auto">
		{#if sections.length}
			{#each sections as s (s.key)}
				<div
					class="sticky top-0 z-10 border-b border-line bg-panel-solid px-1 py-1.5 text-[10.5px] uppercase tracking-[0.16em] text-mute"
				>
					{s.label}
				</div>
				<div class="grid grid-cols-12 gap-1 pb-2">
					{#each s.emojis as e (e.emoji)}
						<button
							type="button"
							class="rounded-[6px] p-1 text-[22px] hover:bg-panel"
							title={e.label}
							onclick={() => pick(e.emoji)}>{e.emoji}</button
						>
					{/each}
				</div>
			{/each}
		{:else}
			<div class="grid grid-cols-12 gap-1">
				{#each results as e (e.emoji)}
					<button
						type="button"
						class="rounded-[6px] p-1 text-[22px] hover:bg-panel"
						title={e.label}
						onclick={() => pick(e.emoji)}>{e.emoji}</button
					>
				{/each}
			</div>
		{/if}
	</div>
</div>
