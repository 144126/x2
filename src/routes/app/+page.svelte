<script lang="ts">
	import { goto } from '$app/navigation';
	import LocationPicker from '$lib/LocationPicker.svelte';
	import Select from '$lib/components/Select.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import { Search, MessageCircle, SlidersHorizontal } from '@lucide/svelte';
	let { data } = $props();

	let q = $state('');
	let gender = $state('');
	let age_min = $state('');
	let age_max = $state('');
	let country = $state('');
	let region = $state('');
	let results = $state<
		{
			id: string;
			n: string;
			a?: string;
			g?: number;
			r?: string;
			co?: string;
			st?: string;
			ci?: string;
			w?: string;
			wu?: string;
			s?: number;
			online?: boolean;
		}[]
	>([]);
	let searching = $state(false);
	let onlineOnly = $state(false);
	let presenceUnavailable = $state(false);
	let filtersOpen = $state(false);

	let activeFilterCount = $derived(
		[gender, age_min, age_max, country, region, onlineOnly ? '1' : ''].filter(Boolean).length
	);

	async function search() {
		searching = true;
		const p = new URLSearchParams();
		if (q.trim()) p.set('q', q.trim());
		if (gender) p.set('gender', gender);
		if (age_min) p.set('age_min', age_min);
		if (age_max) p.set('age_max', age_max);
		if (country) p.set('country', country);
		if (region) p.set('state', region);
		if (onlineOnly) p.set('online', '1');
		const res = await fetch(`/api/search?${p}`);
		const body = await res.json();
		results = body.r ?? [];
		presenceUnavailable = onlineOnly && body.filtered === false;
		searching = false;
	}

	function clearFilters() {
		gender = '';
		age_min = '';
		age_max = '';
		country = '';
		region = '';
		onlineOnly = false;
	}

	function apply() {
		filtersOpen = false;
		search();
	}
</script>

<section>
	<div class="eyebrow">search x2 — by vibe, not keywords</div>
	<h2 class="display mt-3.5 mb-9 text-[clamp(34px,5.5vw,60px)] leading-[0.98]">
		find people who <em class="italic text-accent">get it</em>.
	</h2>

	<div class="flex flex-col gap-3 sm:flex-row">
		<div class="relative min-w-0 flex-1">
			<Search
				size={18}
				class="pointer-events-none absolute top-1/2 left-[18px] -translate-y-1/2 text-faint"
			/>
			<input
				class="w-full py-4 pr-[18px] pl-[46px] text-[17px]"
				placeholder="search by vibe, craft, interests…"
				bind:value={q}
				onkeydown={(e) => e.key === 'Enter' && search()}
			/>
		</div>
		<button
			class="btn btn-amber flex items-center justify-center gap-2 whitespace-nowrap"
			onclick={search}
			disabled={searching}
		>
			{#if !searching}<Search size={15} />{/if}
			{searching ? 'searching' : 'search'}
		</button>
		<button
			class="btn relative shrink-0 !px-4"
			onclick={() => (filtersOpen = true)}
			aria-label="search filters"
			title="filters"
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

	<Modal bind:open={filtersOpen} title="filters">
		<div class="filters flex flex-col gap-4">
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
			<div class="flex gap-3">
				<input
					class="w-full"
					type="number"
					placeholder="age min"
					min="0"
					bind:value={age_min}
					aria-label="minimum age"
				/>
				<input
					class="w-full"
					type="number"
					placeholder="age max"
					min="0"
					bind:value={age_max}
					aria-label="maximum age"
				/>
			</div>
			<LocationPicker bind:country bind:region showCity={false} anyLabel="any country" />
			<label class="flex cursor-pointer items-center gap-2 text-[13px] text-ink-soft">
				<input type="checkbox" class="!w-auto accent-accent" bind:checked={onlineOnly} />
				online now
			</label>
		</div>
		<div class="mt-6 flex items-center gap-3 border-t border-line pt-5">
			<button class="btn px-4 py-2 text-[13px]" onclick={clearFilters}>clear</button>
			<button class="btn btn-amber ml-auto px-4 py-2 text-[13px]" onclick={apply}>apply</button>
		</div>
	</Modal>

	{#if presenceUnavailable}
		<p class="mt-4 text-[13px] text-mute">couldn't check who's online — showing everyone.</p>
	{/if}

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
						<div class="flex items-center gap-2">
							<span class="font-display text-[24px] font-medium tracking-[-0.01em]">{u.n}</span>
							{#if u.online}<span
									class="inline-block h-[7px] w-[7px] rounded-full bg-emerald-400"
									aria-label="online"
								></span>{/if}
						</div>
						{#if u.g || u.r || u.ci || u.st || u.co}
							<div class="text-[12px] tracking-[0.04em] text-mute">
								{#if u.g}{u.g}{/if}{#if u.r}
									· {u.r}{/if}{#if u.ci}
									· {u.ci}{/if}{#if u.st}
									· {u.st}{/if}{#if u.co}
									· {u.co}{/if}
							</div>
						{/if}
					</div>
					{#if u.a}<p class="mt-1 max-w-[60ch] text-[14.5px] leading-[1.5] text-ink-soft">
							{u.a}
						</p>{/if}
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
						{#if u.s !== undefined}
							<div class="font-display text-[15px] tracking-[0.02em] text-accent">
								{(u.s * 100).toFixed(0)}<span class="text-[10px] opacity-70">%</span> match
							</div>
						{/if}
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</section>
