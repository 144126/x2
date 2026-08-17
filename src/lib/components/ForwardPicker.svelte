<script lang="ts">
	import Checkbox from '$lib/components/Checkbox.svelte';
	let {
		data,
		onforward
	}: {
		data: { conversations: { peer: string }[]; rooms: { id: string; name: string }[] };
		onforward: (targets: { to?: string; group?: string }[]) => void;
	} = $props();
	let selected = $state<Set<string>>(new Set());

	const all = $derived([
		...data.conversations.map((c) => ({ key: `u:${c.peer}` as const, label: c.peer, to: c.peer })),
		...data.rooms.map((g) => ({ key: `g:${g.id}` as const, label: g.name, group: g.id }))
	]);

	function toggle(key: string) {
		selected = new Set(
			selected.has(key) ? [...selected].filter((k) => k !== key) : [...selected, key]
		);
	}

	function toggleAll() {
		selected = selected.size === all.length ? new Set() : new Set(all.map((a) => a.key));
	}
</script>

<div class="flex flex-col gap-3">
	<button type="button" class="btn px-2 py-1 text-[11px]" onclick={toggleAll}> select all </button>
	<ul class="flex max-h-[320px] flex-col gap-1 overflow-y-auto">
		{#each all as item (item.key)}
			<li>
				<Checkbox
					checked={selected.has(item.key)}
					label={item.label}
					class="w-full rounded-[8px] px-2 py-1.5 text-[13.5px] hover:bg-panel"
					onchange={() => toggle(item.key)}
				/>
			</li>
		{/each}
	</ul>
	<button
		class="btn btn-amber self-end px-4 py-2 text-[13px]"
		disabled={!selected.size}
		onclick={() =>
			onforward(
				all
					.filter((a) => selected.has(a.key))
					.map((a) => ('to' in a ? { to: a.to } : { group: a.group }))
			)}>forward to {selected.size || ''}</button
	>
</div>
