<script lang="ts">
	import { STICKERS, search_stickers, sticker_src } from '$lib/stickers';
	let { onselect, onclose }: { onselect: (id: string) => void; onclose: () => void } = $props();
	let q = $state('');
	let results = $derived(search_stickers(q));
</script>

<div
	class="flex w-[300px] flex-col rounded-[14px] border border-line bg-panel-solid p-3 shadow-lg"
	role="dialog"
>
	<input class="mb-2 text-[13px]" placeholder="search stickers…" bind:value={q} />
	<div class="grid max-h-[240px] grid-cols-4 gap-2 overflow-y-auto">
		{#each results as s (s.id)}
			<button
				type="button"
				class="rounded-[6px] p-1 hover:bg-panel"
				title={s.id}
				onclick={() => onselect(s.id)}
			>
				<img src={sticker_src(s.id)} alt={s.id + ' sticker'} class="h-[60px] w-[60px] object-contain" />
			</button>
		{/each}
	</div>
</div>
