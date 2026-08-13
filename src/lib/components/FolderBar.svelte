<script lang="ts">
	import Modal from './Modal.svelte';
	import { FolderPlus, Pencil, Plus, Minus } from '@lucide/svelte';

	export type Folder = { id: string; name: string; convs: string[] };
	type Item = { id: string; name: string };

	let {
		folders = $bindable([] as Folder[]),
		active = $bindable(null as string | null),
		items = [] as Item[],
		kind = 'c' as 'c' | 'r',
		itemNoun = 'chats'
	} = $props();

	let newName = $state('');
	let editing = $state(false);
	let activeFolder = $derived(folders.find((fo) => fo.id === active) ?? null);
	const inFolder = (id: string) => !!activeFolder?.convs.includes(id);

	async function create() {
		const name = newName.trim();
		if (!name) return;
		newName = '';
		const res = await fetch('/api/folders', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ name, kind })
		});
		if (res.ok) folders = [...folders, (await res.json()).folder];
	}

	async function toggle(id: string) {
		const folderId = active;
		if (!folderId) return;
		const adding = !inFolder(id);
		const patch = (add: boolean) =>
			(folders = folders.map((fo) =>
				fo.id !== folderId
					? fo
					: { ...fo, convs: add ? [...fo.convs, id] : fo.convs.filter((c) => c !== id) }
			));
		patch(adding);
		const res = adding
			? await fetch(`/api/folders/${folderId}`, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ conv: id })
				})
			: await fetch(`/api/folders/${folderId}?conv=${encodeURIComponent(id)}`, {
					method: 'DELETE'
				});
		if (!res.ok) patch(!adding);
	}
</script>

<div class="mt-3 flex flex-wrap items-center gap-2">
	<button
		class="btn h-9 px-3 py-0 text-[12px]"
		class:btn-amber={active === null}
		onclick={() => (active = null)}
	>
		all
	</button>
	{#each folders as fo (fo.id)}
		<div class="flex h-9 items-stretch">
			<button
				class="btn h-full px-3 py-0 text-[12px]"
				class:btn-amber={active === fo.id}
				class:!rounded-r-none={active === fo.id}
				onclick={() => (active = fo.id)}
			>
				{fo.name}
			</button>
			{#if active === fo.id}
				<button
					class="btn btn-amber h-full !rounded-l-none border-l border-l-accent-ink/15 px-2.5 py-0"
					onclick={() => (editing = true)}
					aria-label="edit {fo.name}"
					title="edit {fo.name}"
				>
					<Pencil size={12} />
				</button>
			{/if}
		</div>
	{/each}
	<div class="relative h-9">
		<FolderPlus
			size={13}
			class="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-faint"
		/>
		<input
			class="h-9 w-[140px] min-w-0 py-0 pr-2 pl-6 text-[12px]"
			placeholder="new folder…"
			bind:value={newName}
			onkeydown={(e) => e.key === 'Enter' && create()}
		/>
	</div>
</div>

<Modal bind:open={editing} title="chats in &ldquo;{activeFolder?.name ?? ''}&rdquo;">
	{#if items.length}
		<ul class="flex flex-col gap-2">
			{#each items as item (item.id)}
				{@const on = inFolder(item.id)}
				<li
					class="flex items-center gap-3 rounded-[12px] border border-line bg-panel px-3.5 py-2.5 transition-colors duration-300"
					class:border-accent={on}
					class:bg-accent-soft={on}
				>
					<span class="min-w-0 flex-1 truncate text-[13px] text-ink">{item.name}</span>
					<button
						class="btn shrink-0 px-3 py-1.5 text-[12px]"
						class:btn-amber={on}
						onclick={() => toggle(item.id)}
						aria-label={on
							? 'remove ' + item.name + ' from ' + itemNoun
							: 'add ' + item.name + ' to ' + itemNoun}
					>
						{#if on}<Minus size={13} />{:else}<Plus size={13} />{/if}
					</button>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="text-[13px] text-faint">no {itemNoun} to file yet.</p>
	{/if}
</Modal>
