<script lang="ts">
	import LocationPicker from '$lib/LocationPicker.svelte';
	import Checkbox from '$lib/components/Checkbox.svelte';
	import Select from '$lib/components/Select.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import { Search, MessageCircle, SlidersHorizontal } from '@lucide/svelte';

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

	// the online toggle sits outside the modal, so it is not part of the modal's badge count
	let activeFilterCount = $derived(
		[gender, age_min, age_max, country, region].filter(Boolean).length
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
	}

	function apply() {
		filtersOpen = false;
		search();
	}
</script>

<svelte:head>
	<title>x2 find — meet people who share your interests</title>
	<meta
		name="description"
		content="search x2 by what someone is actually into — interests, age, and location — instead of the nearest stranger. no signup needed to look."
	/>
</svelte:head>

<section>
	<div class="eyebrow">find people</div>
	<h2 class="display mt-2 mb-5 text-[clamp(24px,4vw,34px)] leading-[0.98]">
		search for <em class="italic text-accent">someone</em> specific.
	</h2>

	<div class="flex flex-row gap-2 sm:gap-3">
		<div class="relative min-w-0 flex-1">
			<Search
				size={15}
				class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint"
			/>
			<input
				class="w-full py-2.5 pr-3 pl-9 text-[13px]"
				placeholder="search by vibe, craft, interests…"
				bind:value={q}
				onkeydown={(e) => e.key === 'Enter' && search()}
			/>
		</div>
		<button
			class="btn btn-amber flex items-center justify-center"
			onclick={search}
			disabled={searching}
			aria-label="search"
			title="search"
		>
			<Search size={15} />
		</button>
		<button
			class="btn btn-icon relative"
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

	<div class="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
		<Checkbox
			bind:checked={onlineOnly}
			label="online now"
			class="btn {onlineOnly ? 'border-accent bg-accent/12 text-ink' : 'text-mute hover:text-ink'}"
			onchange={search}
		>
			{#snippet indicator(on)}
				<span class="relative flex h-[7px] w-[7px] items-center justify-center">
					{#if on}
						<span class="absolute inset-0 animate-ping rounded-full bg-emerald-400/60"></span>
					{/if}
					<span
						class="h-[7px] w-[7px] rounded-full transition-colors duration-300 {on
							? 'bg-emerald-400'
							: 'bg-line-2'}"
					></span>
				</span>
			{/snippet}
		</Checkbox>
		{#if presenceUnavailable}
			<span class="text-[12px] text-mute">couldn't check who's online — showing everyone.</span>
		{/if}
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
		</div>
		<div class="mt-6 flex items-center gap-3 border-t border-line pt-5">
			<button class="btn" onclick={clearFilters}>clear</button>
			<button class="btn btn-amber ml-auto" onclick={apply}>apply</button>
		</div>
	</Modal>

	{#if results.length}
		<ul class="results mt-4 grid gap-2.5">
			{#each results as u, i (u.id)}
				<li class="card person reveal relative" style="--i:{i}">
					<a
						class="after:absolute after:inset-0"
						href="/chat/{u.id}"
						aria-label="open chat with {u.n}"
					>
						<div class="flex flex-col gap-1">
							<div class="flex items-center gap-2">
								<span class="font-display text-[16px] font-medium tracking-[-0.01em]">{u.n}</span>
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
						{#if u.a}<p class="mt-1 max-w-[60ch] text-[13px] leading-[1.5] text-ink-soft">
								{u.a}
							</p>{/if}
					</a>
					<!-- outside the card link: an anchor inside an anchor is invalid html and
					     the browser moves it on hydration -->
					<div class="relative mt-3 flex items-center gap-3 self-end">
						{#if u.wu}
							<a href={u.wu} target="_blank" rel="noopener noreferrer" class="btn no-underline">
								<MessageCircle size={13} /> chat on whatsapp
							</a>
						{/if}
						{#if u.s !== undefined}
							<div class="font-display text-[13px] tracking-[0.02em] text-accent">
								{(u.s * 100).toFixed(0)}<span class="text-[10px] opacity-70">%</span> match
							</div>
						{/if}
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</section>
