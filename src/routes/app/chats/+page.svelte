<script lang="ts">
	import { goto } from '$app/navigation';
	import { ws_on } from '$lib/ws';
	import { onMount } from 'svelte';
	import FolderBar from '$lib/components/FolderBar.svelte';
	let { data } = $props();

	type Conv = { peer: string; last: number; preview: string; name: string; muted?: boolean };
	type Folder = { id: string; name: string; convs: string[] };
	let convs = $state(data.convs as Conv[]);
	let folders = $state(data.folders as Folder[]);
	let activeFolder = $state<string | null>(null);
	let visibleConvs = $derived(
		activeFolder
			? convs.filter((c) => folders.find((fo) => fo.id === activeFolder)?.convs.includes(c.peer))
			: convs
	);

	onMount(() => {
		return ws_on((m) => {
			if (m.type !== 'msg') return;
			const peer = m.from as string;
			const rest = convs.filter((c) => c.peer !== peer);
			const prev = convs.find((c) => c.peer === peer);
			convs = [
				{
					peer,
					last: m.ts as number,
					preview: m.text as string,
					name: prev?.name ?? (m.from_name as string) ?? peer
				},
				...rest
			];
		});
	});
</script>

<section>
	<div class="eyebrow mb-1">recent threads</div>

	<div class="mt-3">
		<FolderBar
			bind:folders
			bind:active={activeFolder}
			items={convs.map((c) => ({ id: c.peer, name: c.name }))}
			kind="c"
		/>
	</div>

	{#if data.hub_error}
		<p class="mt-4 text-[14.5px] text-red-400">
			chats unavailable — the realtime hub isn't reachable. try again shortly.
		</p>
	{:else if visibleConvs.length}
		<ul class="results mt-5 grid gap-3.5">
			{#each visibleConvs as c, i (c.peer)}
				<li class="card person reveal" style="--i:{i}">
					<div onclick={() => goto(`/app/chat/${c.peer}`)} role="button" tabindex="0">
						<div class="flex items-center gap-2">
							<span class="font-display text-[24px] font-medium tracking-[-0.01em]">{c.name}</span>
							{#if c.muted}
								<span class="text-[11px] text-mute">muted</span>
							{/if}
						</div>
						<p class="mt-1 max-w-[60ch] text-[14.5px] leading-[1.5] text-ink-soft">{c.preview}</p>
					</div>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="mt-4 text-[14.5px] text-faint">
			no conversations yet. search for someone with the same vibe.
		</p>
	{/if}
</section>
