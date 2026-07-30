<script lang="ts">
	import { goto } from '$app/navigation';
	import type { GroupView } from '$lib/server/group';
	import Modal from '$lib/components/Modal.svelte';
	import FolderBar from '$lib/components/FolderBar.svelte';
	import LocationPicker from '$lib/LocationPicker.svelte';
	import { Search, Plus, Users, SlidersHorizontal } from '@lucide/svelte';

	type Folder = { id: string; name: string; convs: string[] };

	let { data } = $props();
	let mine = $state(data.mine as GroupView[]);
	let folders = $state(data.folders as Folder[]);
	let activeFolder = $state<string | null>(null);
	let onlyCreated = $state(false);
	let visibleGroups = $derived(
		(activeFolder
			? mine.filter((g) => folders.find((fo) => fo.id === activeFolder)?.convs.includes(g.id))
			: mine
		).filter((g) => !onlyCreated || g.owner === data.user?.id)
	);

	let q = $state('');
	let results = $state<GroupView[]>([]);
	let searching = $state(false);

	let name = $state('');
	let description = $state('');
	let creating = $state(false);
	let err = $state('');
	let creatingOpen = $state(false);

	let country = $state('');
	let region = $state('');
	let city = $state('');
	let filtersOpen = $state(false);
	let activeFilterCount = $derived(
		[country, region, city].filter(Boolean).length
	);

	async function search() {
		searching = true;
		const p = new URLSearchParams();
		if (q.trim()) p.set('q', q.trim());
		if (country) p.set('country', country);
		if (region) p.set('state', region);
		if (city) p.set('city', city);
		const res = await fetch(`/api/groups?${p}`);
		results = res.ok ? ((await res.json()).r ?? []) : [];
		searching = false;
	}

	function clearLocation() {
		country = '';
		region = '';
		city = '';
	}

	function applyLocation() {
		filtersOpen = false;
		search();
	}

	async function create() {
		err = '';
		if (!name.trim()) return;
		creating = true;
		const res = await fetch('/api/groups', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ name, description, country: country || undefined, state: region || undefined, city: city || undefined })
		});
		creating = false;
		if (!res.ok) {
			err = 'could not create that group';
			return;
		}
		const { g } = await res.json();
		creatingOpen = false;
		goto(`/app/rooms/${g.id}`);
	}

	async function join(g: GroupView) {
		const res = await fetch(`/api/groups/${g.id}`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ action: 'join' })
		});
		if (res.ok) {
			mine = [(await res.json()).g, ...mine.filter((m) => m.id !== g.id)];
			goto(`/app/rooms/${g.id}`);
		}
	}
</script>

<section class="mb-[64px]">
	<div class="eyebrow">rooms — many people, one thread</div>
	<h2 class="display mt-3.5 mb-9 text-[clamp(30px,5.5vw,60px)] leading-[0.98]">
		find a <em class="italic text-accent">room</em><br />or start one.
	</h2>

	<div class="flex flex-col gap-3 sm:flex-row">
		<div class="relative min-w-0 flex-1">
			<Search
				size={18}
				class="pointer-events-none absolute top-1/2 left-[18px] -translate-y-1/2 text-faint"
			/>
			<input
				class="w-full py-4 pr-[18px] pl-[46px] text-[17px]"
				placeholder="search rooms by what they're about…"
				bind:value={q}
				onkeydown={(e) => e.key === 'Enter' && search()}
			/>
		</div>
		<button
			class="btn btn-amber flex items-center justify-center py-2"
			onclick={search}
			disabled={searching}
			aria-label="search rooms"
			title="search rooms"
		>
			<Search size={15} />
		</button>
		<button
			class="btn relative shrink-0 !px-4 py-2"
			onclick={() => (filtersOpen = true)}
			aria-label="room filters"
			title="location filters"
		>
			<SlidersHorizontal size={16} />
			{#if activeFilterCount}
				<span
					class="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold text-accent-ink"
					>{activeFilterCount}</span
				>
			{/if}
		</button>
	</div>

	<Modal bind:open={filtersOpen} title="location">
		<div class="filters flex flex-col gap-4">
			<LocationPicker bind:country bind:region bind:city anyLabel="any country" />
		</div>
		<div class="mt-6 flex items-center gap-3 border-t border-line pt-5">
			<button class="btn px-4 py-2 text-[13px]" onclick={clearLocation}>clear</button>
			<button class="btn btn-amber ml-auto px-4 py-2 text-[13px]" onclick={applyLocation}>apply</button>
		</div>
	</Modal>

	{#if results.length}
		<ul class="mt-7 grid gap-3.5">
			{#each results as g, i (g.id)}
				{@const joined = mine.some((m) => m.id === g.id)}
				<li class="card reveal" style="--i:{i}">
					<div class="flex flex-wrap items-baseline justify-between gap-2">
						<a
							href="/app/rooms/{g.id}"
							class="font-display text-[22px] font-medium tracking-[-0.01em] hover:text-accent"
							>{g.name}</a
						>
						{#if g.country || g.state || g.city}
							<div class="text-[12px] tracking-[0.04em] text-mute">
								{[g.city, g.state, g.country].filter(Boolean).join(' · ')}
							</div>
						{/if}
						{#if g.score !== undefined}
							<span class="font-display text-[14px] text-accent"
								>{(g.score * 100).toFixed(0)}<span class="text-[10px] opacity-70">%</span></span
							>
						{/if}
					</div>
					<div class="mt-3 flex items-center gap-3">
						<span class="flex items-center gap-1 text-[12px] text-mute">
							<Users size={13} />
							{g.members.length} member{g.members.length === 1 ? '' : 's'}
						</span>
						<button
							class="btn ml-auto px-4 py-2 text-[12px]"
							onclick={() => (joined ? goto(`/app/rooms/${g.id}`) : join(g))}
						>
							{joined ? 'open' : 'join'}
						</button>
					</div>
				</li>
			{/each}
		</ul>
	{:else if searching === false && q}
		<p class="mt-6 text-[14.5px] text-faint">nothing matched. start the room yourself.</p>
	{/if}
</section>

<section class="mb-[64px]">
	<button class="btn btn-amber flex items-center gap-1.5" onclick={() => (creatingOpen = true)}>
		<Plus size={15} /> start a room
	</button>
</section>

<Modal bind:open={creatingOpen} title="start a room">
	<form class="flex flex-col gap-3" onsubmit={(e) => (e.preventDefault(), create())}>
		<input bind:value={name} placeholder="room name" maxlength="60" />
		<textarea
			bind:value={description}
			rows="3"
			placeholder="what is this room about? this is what people search against."></textarea>
		<LocationPicker bind:country bind:region bind:city anyLabel="country" />
		<button
			class="btn btn-amber flex items-center gap-1.5 self-start"
			type="submit"
			disabled={creating}
		>
			<Plus size={15} />
			{creating ? 'creating' : 'create room'}
		</button>
		{#if err}<p class="text-[13px] text-red-400">{err}</p>{/if}
	</form>
</Modal>

<section>
	<div class="eyebrow mb-1">joined rooms</div>
	<label class="mt-2 flex w-fit cursor-pointer items-center gap-2 text-[12px] text-mute">
		<input type="checkbox" class="!w-auto accent-accent" bind:checked={onlyCreated} />
		rooms you created
	</label>
	<div class="mt-3">
		<FolderBar
			bind:folders
			bind:active={activeFolder}
			items={mine.map((g) => ({ id: g.id, name: g.name }))}
			kind="r"
			itemNoun="rooms"
		/>
	</div>
	{#if visibleGroups.length}
		<ul class="results mt-5 grid gap-3.5">
			{#each visibleGroups as g, i (g.id)}
				<li
					class="card person reveal"
					style="--i:{i}"
					onclick={() => goto(`/app/rooms/${g.id}`)}
					role="button"
					tabindex="0"
				>
					<div class="font-display text-[22px] font-medium tracking-[-0.01em]">{g.name}</div>
					{#if g.country || g.state || g.city}
						<div class="text-[12px] tracking-[0.04em] text-mute mt-1">
							{[g.city, g.state, g.country].filter(Boolean).join(' · ')}
						</div>
					{/if}
				</li>
			{/each}
		</ul>
	{:else}
		<p class="mt-4 text-[14.5px] text-faint">you haven't joined a room yet.</p>
	{/if}
</section>
