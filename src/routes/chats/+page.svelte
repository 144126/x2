<script lang="ts">
	import { ws_on } from '$lib/ws';
	import { onMount } from 'svelte';
	import FolderBar from '$lib/components/FolderBar.svelte';
	import { clock, day_label } from '$lib/time';
	let { data } = $props();

	type Conv = { peer: string; last: number; preview: string; name: string; muted?: boolean };
	type Folder = { id: string; name: string; convs: string[] };
	let convs = $state(data.convs as Conv[]);
	let folders = $state(data.folders as Folder[]);
	let unread = $state((data.unread ?? {}) as Record<string, number>);
	let activeFolder = $state<string | null>(null);
	let visibleConvs = $derived(
		activeFolder
			? convs.filter((c) => folders.find((fo) => fo.id === activeFolder)?.convs.includes(c.peer))
			: convs
	);

	const when = (ts: number) => (day_label(ts) === 'today' ? clock(ts) : day_label(ts));

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
			unread = { ...unread, [peer]: (unread[peer] ?? 0) + 1 };
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
		<p class="mt-4 text-[13px] text-red-400">
			chats unavailable — the realtime hub isn't reachable. try again shortly.
		</p>
	{:else if visibleConvs.length}
		<ul class="results mt-4 grid gap-2">
			{#each visibleConvs as c, i (c.peer)}
				<li>
					<a class="card person reveal" style="--i:{i}" href="/chat/{c.peer}">
						<div class="flex items-center gap-2">
							<span class="min-w-0 truncate font-display text-[15px] font-medium tracking-[-0.01em]"
								>{c.name}</span
							>
							{#if c.muted}<span class="text-[10px] text-mute">muted</span>{/if}
							<span class="ml-auto shrink-0 text-[10px] tabular-nums text-mute">{when(c.last)}</span
							>
							{#if unread[c.peer]}
								<span
									class="flex h-[17px] min-w-[17px] shrink-0 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold text-accent-ink"
									>{unread[c.peer]}</span
								>
							{/if}
						</div>
						<p class="line-clamp-1 max-w-[60ch] text-[12.5px] text-ink-soft">{c.preview}</p>
					</a>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="mt-4 text-[13px] text-faint">
			no conversations yet. talk to a stranger on the homepage, or search someone with the same
			vibe.
		</p>
	{/if}
</section>
