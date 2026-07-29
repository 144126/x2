<script lang="ts">
	import { onMount } from 'svelte';
	import Select from './components/Select.svelte';

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

	onMount(() => {
		loadCountries();
		if (country) loadRegions(country);
	});

	// country-driven, not a click handler: also fires when `country` is set programmatically
	// (e.g. a bound parent resetting the filter), matching the native <select onchange> behavior
	// this replaces only for genuine user-driven changes, not the initial mount value.
	let prev_country = country;
	$effect(() => {
		if (country === prev_country) return;
		prev_country = country;
		region = '';
		loadRegions(country);
	});
</script>

<div class="flex min-w-0 flex-wrap gap-3">
	<div class="min-w-[160px] max-w-full flex-1">
		<Select
			bind:value={country}
			aria-label="country"
			placeholder={anyLabel}
			options={countries.map((c) => ({ value: c.isoCode, label: c.name }))}
		/>
	</div>
	{#if country && regions.length}
		<div class="min-w-[160px] max-w-full flex-1">
			<Select
				bind:value={region}
				aria-label="state or region"
				placeholder="any state/region"
				options={regions.map((r) => ({ value: r.isoCode, label: r.name }))}
			/>
		</div>
	{/if}
	{#if showCity}
		<input
			type="text"
			placeholder="city (optional)"
			bind:value={city}
			aria-label="city"
			class="max-w-full"
		/>
	{/if}
</div>
