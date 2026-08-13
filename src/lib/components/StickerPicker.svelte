<script lang="ts">
	import { onMount } from 'svelte';
	import { search_stickers, sticker_src, custom_id } from '$lib/stickers';
	import { upload_image } from '$lib/attach';
	import { Plus, Trash2, LoaderCircle } from '@lucide/svelte';

	let { onselect }: { onselect: (id: string) => void } = $props();
	let q = $state('');
	let results = $derived(search_stickers(q));
	let mine = $state<string[]>([]);
	let busy = $state(false);
	let err = $state('');
	let editing = $state(false);

	onMount(async () => {
		const res = await fetch('/api/stickers').catch(() => null);
		if (res?.ok) mine = ((await res.json()) as { r: string[] }).r;
	});

	async function add(e: Event) {
		const file = (e.currentTarget as HTMLInputElement).files?.[0];
		if (!file) return;
		err = '';
		busy = true;
		const up = await upload_image(file);
		if (up.error || !up.key) {
			busy = false;
			err = up.error ?? 'upload failed';
			return;
		}
		const res = await fetch('/api/stickers', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ key: up.key })
		}).catch(() => null);
		busy = false;
		if (!res?.ok) {
			err = 'could not save that sticker';
			return;
		}
		mine = ((await res.json()) as { r: string[] }).r;
	}

	async function drop(key: string) {
		const res = await fetch(`/api/stickers?key=${encodeURIComponent(key)}`, {
			method: 'DELETE'
		}).catch(() => null);
		if (res?.ok) mine = ((await res.json()) as { r: string[] }).r;
	}
</script>

<div class="flex flex-col gap-3" role="dialog">
	<input placeholder="search stickers…" bind:value={q} />

	{#if !q}
		<div class="flex items-center gap-2">
			<span class="eyebrow">yours</span>
			{#if mine.length}
				<button
					class="ml-auto text-[11px] text-mute hover:text-accent"
					onclick={() => (editing = !editing)}>{editing ? 'done' : 'edit'}</button
				>
			{/if}
		</div>
		<div class="grid grid-cols-4 gap-2 sm:grid-cols-6">
			<label
				class="flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-[10px] border border-dashed border-line-2 text-mute transition-colors hover:border-accent hover:text-accent"
				title="make a sticker from an image"
			>
				{#if busy}<LoaderCircle size={16} class="animate-spin" />{:else}<Plus size={16} />{/if}
				<span class="text-[9.5px] uppercase tracking-[0.14em]">new</span>
				<input type="file" accept="image/*" class="hidden" onchange={add} disabled={busy} />
			</label>
			{#each mine as key (key)}
				<div class="relative">
					<button
						type="button"
						class="w-full rounded-[10px] p-1 transition-colors hover:bg-panel"
						title="your sticker"
						onclick={() => onselect(custom_id(key))}
					>
						<img
							src={sticker_src(custom_id(key))}
							alt="your sticker"
							class="aspect-square w-full object-contain"
						/>
					</button>
					{#if editing}
						<button
							type="button"
							class="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full border border-line bg-panel-solid text-danger"
							aria-label="delete sticker"
							onclick={() => drop(key)}><Trash2 size={11} /></button
						>
					{/if}
				</div>
			{/each}
		</div>
		{#if err}<p class="text-[11.5px] text-danger">{err}</p>{/if}
		<span class="eyebrow mt-1">basics</span>
	{/if}

	<div class="grid grid-cols-4 gap-2 sm:grid-cols-6">
		{#each results as s (s.id)}
			<button
				type="button"
				class="rounded-[10px] p-1 transition-colors hover:bg-panel"
				title={s.id}
				onclick={() => onselect(s.id)}
			>
				<img
					src={sticker_src(s.id)}
					alt={s.id + ' sticker'}
					class="aspect-square w-full object-contain"
				/>
			</button>
		{/each}
	</div>
</div>
