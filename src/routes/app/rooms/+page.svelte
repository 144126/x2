<script lang="ts">
	import { goto } from '$app/navigation';
	import type { GroupView } from '$lib/server/group';
	import { Search, Plus, Users } from '@lucide/svelte';

	let { data } = $props();
	let mine = $state(data.mine as GroupView[]);

	let q = $state('');
	let results = $state<GroupView[]>([]);
	let searching = $state(false);

	let name = $state('');
	let description = $state('');
	let creating = $state(false);
	let err = $state('');

	async function search() {
		searching = true;
		const res = await fetch(`/api/groups?q=${encodeURIComponent(q.trim())}`);
		results = res.ok ? ((await res.json()).r ?? []) : [];
		searching = false;
	}

	async function create() {
		err = '';
		if (!name.trim()) return;
		creating = true;
		const res = await fetch('/api/groups', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ name, description })
		});
		creating = false;
		if (!res.ok) {
			err = 'could not create that group';
			return;
		}
		const { g } = await res.json();
		goto(`/app/groups/${g.id}`);
	}

	async function join(g: GroupView) {
		const res = await fetch(`/api/groups/${g.id}`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ action: 'join' })
		});
		if (res.ok) {
			mine = [(await res.json()).g, ...mine.filter((m) => m.id !== g.id)];
			goto(`/app/groups/${g.id}`);
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
			<Search size={18} class="pointer-events-none absolute top-1/2 left-[18px] -translate-y-1/2 text-faint" />
			<input
				class="w-full py-4 pr-[18px] pl-[46px] text-[17px]"
				placeholder="search rooms by what they're about…"
				bind:value={q}
				onkeydown={(e) => e.key === 'Enter' && search()}
			/>
		</div>
		<button class="btn btn-amber flex items-center justify-center gap-2 whitespace-nowrap" onclick={search} disabled={searching}>
			{#if !searching}<Search size={15} />{/if} {searching ? 'searching' : 'find rooms'}
		</button>
	</div>

	{#if results.length}
		<ul class="mt-7 grid gap-3.5">
			{#each results as g, i (g.id)}
				{@const joined = mine.some((m) => m.id === g.id)}
				<li class="card reveal" style="--i:{i}">
					<div class="flex flex-wrap items-baseline justify-between gap-2">
						<a
							href="/app/groups/{g.id}"
							class="font-display text-[22px] font-medium tracking-[-0.01em] hover:text-accent"
							>{g.name}</a
						>
						{#if g.score !== undefined}
							<span class="font-display text-[14px] text-accent"
								>{(g.score * 100).toFixed(0)}<span class="text-[10px] opacity-70">%</span></span
							>
						{/if}
					</div>
					{#if g.description}
						<p class="mt-1.5 max-w-[60ch] text-[14.5px] leading-[1.5] text-ink-soft">{g.description}</p>
					{/if}
					<div class="mt-3 flex items-center gap-3">
						<span class="flex items-center gap-1 text-[12px] text-mute">
							<Users size={13} /> {g.members.length} member{g.members.length === 1 ? '' : 's'}
						</span>
						<button class="btn ml-auto px-4 py-2 text-[12px]" onclick={() => (joined ? goto(`/app/groups/${g.id}`) : join(g))}>
							{joined ? 'open' : 'join'}
						</button>
					</div>
				</li>
			{/each}
		</ul>
	{:else if searching === false && q}
		<p class="mt-6 text-[14.5px] text-faint">nothing matched. start the room yourself below.</p>
	{/if}
</section>

<section class="mb-[64px]">
	<div class="eyebrow mb-4">start a room</div>
	<form class="flex flex-col gap-3" onsubmit={(e) => (e.preventDefault(), create())}>
		<input bind:value={name} placeholder="room name" maxlength="60" />
		<textarea
			bind:value={description}
			rows="3"
			placeholder="what is this room about? this is what people search against."
		></textarea>
		<button class="btn btn-amber flex items-center gap-1.5 self-start" type="submit" disabled={creating}>
			<Plus size={15} /> {creating ? 'creating' : 'create room'}
		</button>
		{#if err}<p class="text-[13px] text-red-400">{err}</p>{/if}
	</form>
</section>

<section>
	<div class="eyebrow mb-1">your rooms</div>
	{#if mine.length}
		<ul class="mt-5 grid gap-3.5">
			{#each mine as g, i (g.id)}
				<li class="card person reveal" style="--i:{i}" onclick={() => goto(`/app/groups/${g.id}`)} role="button" tabindex="0">
					<div class="font-display text-[22px] font-medium tracking-[-0.01em]">{g.name}</div>
					{#if g.description}
						<p class="mt-1 max-w-[60ch] text-[14.5px] leading-[1.5] text-ink-soft">{g.description}</p>
					{/if}
				</li>
			{/each}
		</ul>
	{:else}
		<p class="mt-4 text-[14.5px] text-faint">you haven't joined a room yet.</p>
	{/if}
</section>
