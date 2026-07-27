<script lang="ts">
	import { goto } from '$app/navigation';
	import LocationPicker from '$lib/LocationPicker.svelte';
	let { data } = $props();

	let q = $state('');
	let gender = $state('');
	let age_min = $state('');
	let age_max = $state('');
	let country = $state('');
	let region = $state('');
	let results = $state<
		{ id: string; n: string; a?: string; g?: number; r?: string; co?: string; st?: string; ci?: string; s: number }[]
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
	<div class="eyebrow">the index</div>
	<h2 class="display mt-3.5 mb-9 text-[clamp(34px,5.5vw,60px)] leading-[0.98]">
		find someone<br />by what they <em class="italic text-accent">mean</em>.
	</h2>

	<div class="flex flex-col gap-3 sm:flex-row">
		<input
			class="text-[17px] py-4 px-[18px]"
			placeholder="search by vibe, craft, interests…"
			bind:value={q}
			onkeydown={(e) => e.key === 'Enter' && search()}
		/>
		<button class="btn btn-amber whitespace-nowrap" onclick={search} disabled={searching}>
			{searching ? 'searching' : 'search'}
		</button>
	</div>

	<div class="mt-3.5 flex flex-wrap items-center gap-3">
		<select class="w-auto flex-1" bind:value={gender}>
			<option value="">any gender</option>
			<option value="m">male</option>
			<option value="f">female</option>
			<option value="o">other</option>
		</select>
		<input
			class="w-[90px]"
			type="number"
			placeholder="age min"
			min="0"
			bind:value={age_min}
			aria-label="minimum age"
		/>
		<input
			class="w-[90px]"
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
					<div class="self-end font-display text-[15px] tracking-[0.02em] text-accent">
						{(u.s * 100).toFixed(0)}<span class="text-[10px] opacity-70">%</span> match
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<section>
	<div class="eyebrow mb-1">recent threads</div>
	{#if data.convs.length}
		<ul class="results mt-5 grid gap-3.5">
			{#each data.convs as c, i (c.peer)}
				<li
					class="card person reveal"
					style="--i:{i}"
					onclick={() => goto(`/app/chat/${c.peer}`)}
					role="button"
					tabindex="0"
				>
					<div class="font-display text-[24px] font-medium tracking-[-0.01em]">{c.name}</div>
					<p class="mt-1 max-w-[60ch] text-[14.5px] leading-[1.5] text-ink-soft">{c.preview}</p>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="mt-4 text-[14.5px] text-faint">no threads yet — search above to begin one.</p>
	{/if}
</section>
