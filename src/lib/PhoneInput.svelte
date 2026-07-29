<script lang="ts">
	import { countries, type Country } from '$lib/data/countries';

	let {
		value = '',
		defaultCountry = '',
		onChange
	}: {
		value?: string;
		defaultCountry?: string;
		onChange?: (v: string) => void;
	} = $props();

	let selectedCountry = $state<Country | null>(null);
	let phoneNumber = $state('');
	let open = $state(false);
	let search = $state('');
	let searchRef = $state<HTMLInputElement | null>(null);
	let listRef = $state<HTMLUListElement | null>(null);
	let activeIdx = $state(0);

	function findCountryByDial(dial: string): Country | undefined {
		return countries.find((c) => value.startsWith(c.d));
	}

	$effect(() => {
		if (value) {
			const matched = findCountryByDial(value);
			if (matched) {
				selectedCountry = matched;
				phoneNumber = value.slice(matched.d.length);
				return;
			}
			phoneNumber = value;
		}
	});

	$effect(() => {
		if (!selectedCountry && defaultCountry) {
			const fallback = countries.find((c) => c.c === defaultCountry);
			if (fallback) selectedCountry = fallback;
		}
		if (!selectedCountry) selectedCountry = null;
	});

	let filtered = $derived(
		search
			? countries.filter(
					(c) =>
						c.n.toLowerCase().includes(search.toLowerCase()) ||
						c.d.includes(search) ||
						c.c.toLowerCase().includes(search.toLowerCase())
				)
			: countries
	);

	$effect(() => {
		if (open) {
			activeIdx = 0;
			search = '';
			requestAnimationFrame(() => searchRef?.focus());
		}
	});

	function emit() {
		const full = selectedCountry ? selectedCountry.d + phoneNumber.replace(/^0+/, '') : phoneNumber;
		onChange?.(full || '');
	}

	function selectCountry(c: Country) {
		selectedCountry = c;
		open = false;
		emit();
	}

	function handlePhoneInput(e: Event) {
		phoneNumber = (e.target as HTMLInputElement).value;
		emit();
	}

	function toggleOpen() {
		open = !open;
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			activeIdx = Math.min(activeIdx + 1, filtered.length - 1);
			listRef?.children[activeIdx]?.scrollIntoView({ block: 'nearest' });
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			activeIdx = Math.max(activeIdx - 1, 0);
			listRef?.children[activeIdx]?.scrollIntoView({ block: 'nearest' });
		} else if (e.key === 'Enter' && open) {
			e.preventDefault();
			selectCountry(filtered[activeIdx]);
		} else if (e.key === 'Escape') {
			open = false;
		}
	}

	function onBackdropClick() {
		open = false;
	}
</script>

<div
	class="pi-wrap"
	class:pi-open={open}
	onclick={(e) => e.stopPropagation()}
	onkeydown={handleKeydown}
>
	<div class="pi-field">
		<button
			type="button"
			class="pi-trigger"
			onclick={toggleOpen}
			aria-expanded={open}
			aria-haspopup="listbox"
			aria-label="Select country code"
		>
			{#if selectedCountry}
				<span class="pi-flag">{selectedCountry.f}</span>
				<span class="pi-dial">{selectedCountry.d}</span>
			{:else}
				<span class="pi-dial pi-placeholder">+000</span>
			{/if}
			<svg
				class="pi-chevron"
				class:pi-chevron-up={open}
				width="12"
				height="12"
				viewBox="0 0 12 12"
				aria-hidden="true"
			>
				<path
					d="M3 5l3 3 3-3"
					fill="none"
					stroke="currentColor"
					stroke-width="1.5"
					stroke-linecap="round"
					stroke-linejoin="round"
				/>
			</svg>
		</button>

		{#if open}
			<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
			<div class="pi-backdrop" onclick={onBackdropClick}></div>
			<div class="pi-dropdown" role="listbox" aria-label="Countries">
				<div class="pi-search-wrap">
					<input
						type="text"
						class="pi-search"
						placeholder="Search country..."
						bind:value={search}
						bind:this={searchRef}
						role="searchbox"
					/>
				</div>
				<ul class="pi-list" bind:this={listRef}>
					{#each filtered as country, i (country.c)}
						<li>
							<button
								type="button"
								class="pi-option"
								class:pi-active={i === activeIdx}
								class:pi-selected={selectedCountry !== null && country.c === selectedCountry.c}
								role="option"
								aria-selected={selectedCountry !== null && country.c === selectedCountry.c}
								onclick={() => selectCountry(country)}
								onmouseenter={() => (activeIdx = i)}
							>
								<span class="pi-flag">{country.f}</span>
								<span class="pi-name">{country.n}</span>
								<span class="pi-dial">{country.d}</span>
							</button>
						</li>
					{/each}
					{#if filtered.length === 0}
						<li class="pi-no-results">No countries found</li>
					{/if}
				</ul>
			</div>
		{/if}

		<input
			type="tel"
			class="pi-number"
			value={phoneNumber}
			oninput={handlePhoneInput}
			placeholder="phone number"
			aria-label="Phone number"
		/>
	</div>
</div>

<style>
	.pi-wrap {
		position: relative;
		width: 100%;
	}

	.pi-field {
		display: flex;
		align-items: center;
		border-radius: 12px;
		border: 1px solid var(--color-line);
		background: var(--color-panel-solid);
		transition: border-color 300ms;
	}
	.pi-field:focus-within {
		border-color: var(--color-accent);
	}

	.pi-trigger {
		display: flex;
		align-items: center;
		gap: 5px;
		flex-shrink: 0;
		height: 48px;
		padding: 0 10px 0 14px;
		border: none;
		border-radius: 12px 0 0 12px;
		background: transparent;
		color: var(--color-ink);
		cursor: pointer;
		font-size: 14px;
		font-family: var(--font-ui);
		outline: none;
		white-space: nowrap;
	}
	.pi-trigger:hover {
		background: rgba(236, 231, 221, 0.04);
	}

	.pi-flag {
		font-size: 18px;
		line-height: 1;
	}

	.pi-dial {
		font-size: 13px;
		font-weight: 500;
		color: var(--color-ink);
	}

	.pi-placeholder {
		color: var(--color-mute);
		font-weight: 400;
	}

	.pi-chevron {
		color: var(--color-mute);
		flex-shrink: 0;
		transition: transform 180ms ease;
	}
	.pi-chevron-up {
		transform: rotate(180deg);
	}

	.pi-backdrop {
		position: fixed;
		inset: 0;
		z-index: 40;
	}

	.pi-dropdown {
		position: absolute;
		z-index: 50;
		top: calc(100% + 4px);
		left: 0;
		width: 320px;
		max-height: 320px;
		overflow: hidden;
		border: 1px solid var(--color-line-2);
		border-radius: 10px;
		background: var(--color-panel-solid);
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
		display: flex;
		flex-direction: column;
	}

	.pi-search-wrap {
		padding: 8px;
		border-bottom: 1px solid var(--color-line);
		flex-shrink: 0;
	}

	.pi-search {
		width: 100%;
		min-height: 36px;
		padding: 8px 12px;
		border-radius: 6px;
		border: 1px solid var(--color-line);
		background: var(--color-base);
		color: var(--color-ink);
		font-size: 13px;
		font-family: var(--font-ui);
		outline: none;
	}
	.pi-search:focus {
		border-color: var(--color-accent);
	}

	.pi-list {
		list-style: none;
		margin: 0;
		padding: 4px;
		overflow-y: auto;
		flex: 1;
	}

	.pi-option {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		padding: 8px 10px;
		border: none;
		border-radius: 6px;
		background: transparent;
		color: var(--color-ink-soft);
		font-size: 13px;
		font-family: var(--font-ui);
		cursor: pointer;
		text-align: left;
	}
	.pi-option:hover,
	.pi-option.pi-active {
		background: var(--color-accent-soft);
	}
	.pi-option.pi-selected {
		font-weight: 500;
		color: var(--color-ink);
		background: rgba(236, 231, 221, 0.06);
	}

	.pi-name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.pi-option .pi-dial {
		color: var(--color-mute);
		font-size: 12px;
		flex-shrink: 0;
	}

	.pi-no-results {
		padding: 20px 12px;
		color: var(--color-mute);
		font-size: 13px;
		text-align: center;
	}

	.pi-number {
		flex: 1;
		min-width: 0;
		height: 48px;
		padding: 0 14px 0 8px;
		border: none;
		border-radius: 0 12px 12px 0;
		background: transparent;
		color: var(--color-ink);
		font-size: 14px;
		font-family: var(--font-ui);
		outline: none;
	}
	.pi-number::placeholder {
		color: var(--color-mute);
	}
</style>
