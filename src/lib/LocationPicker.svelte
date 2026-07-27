<script lang="ts">
	import { onMount } from 'svelte';

	let {
		country = $bindable(''),
		region = $bindable(''),
		city = $bindable(''),
		anyLabel = 'any location',
		showCity = true
	}: {
		country?: string;
		region?: string;
		city?: string;
		anyLabel?: string;
		showCity?: boolean;
	} = $props();

	let countries = $state<{ isoCode: string; name: string }[]>([]);
	let regions = $state<{ isoCode: string; name: string }[]>([]);

	// country-state-city ships ~635KB of country+state data (no cities — that dataset alone is
	// 7.7MB, impractical to ship for a dropdown); dynamic-imported so it's a separate lazy chunk,
	// never part of the initial page load or the Workers server bundle.
	async function loadCountries() {
		const { Country } = await import('country-state-city');
		countries = Country.getAllCountries().map((c) => ({ isoCode: c.isoCode, name: c.name }));
	}

	async function loadRegions(countryCode: string) {
		if (!countryCode) {
			regions = [];
			return;
		}
		const { State } = await import('country-state-city');
		regions = State.getStatesOfCountry(countryCode).map((s) => ({
			isoCode: s.isoCode,
			name: s.name
		}));
	}

	function onCountryChange() {
		region = '';
		loadRegions(country);
	}

	onMount(() => {
		loadCountries();
		if (country) loadRegions(country);
	});
</script>

<div class="flex min-w-0 flex-wrap gap-3">
	<select bind:value={country} onchange={onCountryChange} aria-label="country" class="max-w-full">
		<option value="">{anyLabel}</option>
		{#each countries as c (c.isoCode)}
			<option value={c.isoCode}>{c.name}</option>
		{/each}
	</select>
	{#if country && regions.length}
		<select bind:value={region} aria-label="state or region" class="max-w-full">
			<option value="">any state/region</option>
			{#each regions as r (r.isoCode)}
				<option value={r.isoCode}>{r.name}</option>
			{/each}
		</select>
	{/if}
	{#if showCity}
		<input type="text" placeholder="city (optional)" bind:value={city} aria-label="city" class="max-w-full" />
	{/if}
</div>
