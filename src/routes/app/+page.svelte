<script lang="ts">
	import { goto } from '$app/navigation';
	import LocationPicker from '$lib/LocationPicker.svelte';
	import Select from '$lib/components/Select.svelte';
	import { ws_on } from '$lib/ws';
	import { onMount } from 'svelte';
	import { Search, FolderPlus, MessageCircle } from '@lucide/svelte';
	let { data } = $props();

	// thread list was server-rendered only, so a new message never showed up here without a
	// reload — the literal "have to reload to see latest" symptom
	type Conv = { peer: string; last: number; preview: string; name: string };
	type Folder = { id: string; name: string; convs: string[] };
	let convs = $state(data.convs as Conv[]);
	let folders = $state(data.folders as Folder[]);
	let activeFolder = $state<string | null>(null); // null === "all"
	let newFolderName = $state('');
	let visibleConvs = $derived(
		activeFolder
			? convs.filter((c) => folders.find((fo) => fo.id === activeFolder)?.convs.includes(c.peer))
			: convs
	);

	async function createFolder() {
		const name = newFolderName.trim();
		if (!name) return;
		newFolderName = '';
		const res = await fetch('/api/folders', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ name })
		});
		if (res.ok) folders = [...folders, (await res.json()).folder];
	}

	async function assignToFolder(peer: string, folderId: string) {
		if (!folderId) return;
		await fetch(`/api/folders/${folderId}`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ conv: peer })
		});
		folders = folders.map((fo) =>
			fo.id === folderId && !fo.convs.includes(peer) ? { ...fo, convs: [...fo.convs, peer] } : fo
		);
	}

	onMount(() => {
		console.log('[APP-CLIENT] subscribing to ws_on for thread-list live updates');
		return ws_on((m) => {
			console.log('[APP-CLIENT] ws message received on threads list', m);
			if (m.type !== 'msg') return;
			const peer = m.from as string;
			console.log('[APP-CLIENT] bumping conv to top of thread list', { peer });
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

	let q = $state('');
	let gender = $state('');
	let age_min = $state('');
	let age_max = $state('');
	let country = $state('');
	let region = $state('');
	let results = $state<
		{ id: string; n: string; a?: string; g?: number; r?: string; co?: string; st?: string; ci?: string; w?: string; wu?: string; s: number }[]
	>([]);
	let searching = $state(false);

	async function search() {
		if (!q.trim()) return;
		searching = true;
		const p = new URLSearchParams({ q });
		if (gender) p.set('gender', gender);
		if (age_min) p.set('age_min', age_min);
		if (age_max) p.set('age_max', age_max);
		if (country) p.set('country', country);
		if (region) p.set('state', region);
		const res = await fetch(`/api/search?${p}`);
		results = (await res.json()).r ?? [];
		searching = false;
	}
</script>

<section class="mb-[72px]">
	<div class="eyebrow">search x2 — by vibe, not keywords</div>
	<h2 class="display mt-3.5 mb-9 text-[clamp(34px,5.5vw,60px)] leading-[0.98]">
		find people who <em class="italic text-accent">get it</em>.
	</h2>

	<div class="flex flex-col gap-3 sm:flex-row">
		<div class="relative min-w-0 flex-1">
			<Search size={18} class="pointer-events-none absolute top-1/2 left-[18px] -translate-y-1/2 text-faint" />
			<input
				class="w-full py-4 pr-[18px] pl-[46px] text-[17px]"
				placeholder="search by vibe, craft, interests…"
				bind:value={q}
				onkeydown={(e) => e.key === 'Enter' && search()}
			/>
		</div>
		<button class="btn btn-amber flex items-center justify-center gap-2 whitespace-nowrap" onclick={search} disabled={searching}>
			{#if !searching}<Search size={15} />{/if} {searching ? 'searching' : 'find my people'}
		</button>
	</div>

	<div class="filters mt-3.5 flex flex-wrap items-center gap-3">
		<div class="min-w-[140px] flex-1">
			<Select
				bind:value={gender}
				aria-label="gender"
				placeholder="any gender"
				options={[
					{ value: 'm', label: 'male' },
					{ value: 'f', label: 'female' },
					{ value: 'o', label: 'other' }
				]}
			/>
		</div>
		<input
			class="w-[90px] min-w-0"
			type="number"
			placeholder="age min"
			min="0"
			bind:value={age_min}
			aria-label="minimum age"
		/>
		<input
			class="w-[90px] min-w-0"
			type="number"
			placeholder="age max"
			min="0"
			bind:value={age_max}
			aria-label="maximum age"
		/>
		<LocationPicker bind:country bind:region showCity={false} anyLabel="any country" />
	</div>

	{#if results.length}
		<ul class="results mt-7 grid gap-3.5">
			{#each results as u, i (u.id)}
				<li
					class="card person reveal"
					style="--i:{i}"
					onclick={() => goto(`/app/chat/${u.id}`)}
					role="button"
					tabindex="0"
				>
					<div class="flex flex-col gap-1.5">
						<div class="font-display text-[24px] font-medium tracking-[-0.01em]">{u.n}</div>
						{#if u.g || u.r || u.ci || u.st || u.co}
							<div class="text-[12px] tracking-[0.04em] text-mute">
								{#if u.g}{u.g}{/if}{#if u.r} · {u.r}{/if}{#if u.ci} · {u.ci}{/if}{#if u.st} · {u.st}{/if}{#if u.co} · {u.co}{/if}
							</div>
						{/if}
					</div>
					{#if u.a}<p class="mt-1 max-w-[60ch] text-[14.5px] leading-[1.5] text-ink-soft">{u.a}</p>{/if}
					<div class="mt-3 flex items-center gap-3 self-end">
						{#if u.wu}
							<a
								href={u.wu}
								target="_blank"
								rel="noopener noreferrer"
								class="btn flex items-center gap-1.5 py-1.5 px-3 text-[12px] no-underline"
								onclick={(e) => e.stopPropagation()}
							>
								<MessageCircle size={13} /> chat on whatsapp
							</a>
						{/if}
						<div class="font-display text-[15px] tracking-[0.02em] text-accent">
							{(u.s * 100).toFixed(0)}<span class="text-[10px] opacity-70">%</span> match
						</div>
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<section>
	<div class="eyebrow mb-1">recent threads</div>

	<div class="mt-3 flex flex-wrap items-center gap-2">
		<button
			class="btn text-[12px] py-1.5 px-3"
			class:btn-amber={activeFolder === null}
			onclick={() => (activeFolder = null)}
		>
			all
		</button>
		{#each folders as fo (fo.id)}
			<button
				class="btn text-[12px] py-1.5 px-3"
				class:btn-amber={activeFolder === fo.id}
				onclick={() => (activeFolder = fo.id)}
			>
				{fo.name}
			</button>
		{/each}
		<div class="relative">
			<FolderPlus size={13} class="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-faint" />
			<input
				class="w-[140px] min-w-0 py-1.5 pr-2 pl-6 text-[12px]"
				placeholder="new folder…"
				bind:value={newFolderName}
				onkeydown={(e) => e.key === 'Enter' && createFolder()}
			/>
		</div>
	</div>

	{#if visibleConvs.length}
		<ul class="results mt-5 grid gap-3.5">
			{#each visibleConvs as c, i (c.peer)}
				<li class="card person reveal" style="--i:{i}">
					<div
						onclick={() => goto(`/app/chat/${c.peer}`)}
						role="button"
						tabindex="0"
					>
						<div class="font-display text-[24px] font-medium tracking-[-0.01em]">{c.name}</div>
						<p class="mt-1 max-w-[60ch] text-[14.5px] leading-[1.5] text-ink-soft">{c.preview}</p>
					</div>
					{#if folders.length}
						<select
							class="mt-2 text-[12px]"
							onchange={(e) => assignToFolder(c.peer, (e.currentTarget as HTMLSelectElement).value)}
						>
							<option value="">add to folder…</option>
							{#each folders as fo (fo.id)}
								<option value={fo.id}>{fo.name}</option>
							{/each}
						</select>
					{/if}
				</li>
			{/each}
		</ul>
	{:else}
		<p class="mt-4 text-[14.5px] text-faint">no conversations yet. search for someone with the same vibe.</p>
	{/if}
</section>
