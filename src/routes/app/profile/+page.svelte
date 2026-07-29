<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import type { User } from '$lib/types';
	import LocationPicker from '$lib/LocationPicker.svelte';
	import PhoneInput from '$lib/PhoneInput.svelte';
	import Select from '$lib/components/Select.svelte';
	let { data } = $props();
	let p = $state(data.p as User);

	let credit_balance = $state<number | null>(null);
	let buying = $state(false);

	async function load_credits() {
		const res = await fetch('/api/credits');
		if (res.ok) credit_balance = (await res.json()).balance;
	}

	async function buy_credits(amount_kobo: number) {
		buying = true;
		const res = await fetch('/api/credits/purchase', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ amount_kobo })
		});
		buying = false;
		if (res.ok) {
			const { authorization_url } = await res.json();
			window.location.href = authorization_url;
		}
	}

	onMount(load_credits);

	let about = $state(p.a ?? '');
	let username = $state(p.u ?? '');
	let interests = $state<string[]>(p.i ?? []);
	let interestInput = $state('');
	let age = $state(p.ag ?? '');
	let gender = $state(p.r ?? '');
	let country = $state(p.co ?? '');
	let region = $state(p.st ?? '');
	let city = $state(p.ci ?? '');
	let whatsapp = $state(p.w ?? '');
	let saved = $state(false);

	function addInterest() {
		const t = interestInput.trim();
		if (t && !interests.includes(t)) interests = [...interests, t];
		interestInput = '';
	}

	function removeInterest(t: string) {
		interests = interests.filter((i) => i !== t);
	}

	async function save() {
		saved = false;
		const res = await fetch('/api/profile', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				about,
				username,
				interests,
				age: age ? Number(age) : undefined,
				gender,
				country,
				state: region,
				city,
				whatsapp
			})
		});
		saved = res.ok;
	}
</script>

<section class="prof reveal mx-auto max-w-[560px]">
	<div class="eyebrow">your card</div>
	<h1 class="display mt-3 mb-10 text-[clamp(40px,6vw,64px)]">{username || p.m?.split('@')[0] || 'profile'}</h1>

	<form onsubmit={(e) => (e.preventDefault(), save())} class="flex flex-col gap-2">
		<label class="eyebrow mt-6" for="p-username">username</label>
		<input id="p-username" bind:value={username} placeholder="display handle" />

		<label class="eyebrow mt-6" for="p-interests">interests</label>
		<div
			class="flex min-h-[48px] flex-wrap items-center gap-2 rounded-[12px] border border-line bg-panel-solid px-3 py-2 transition-colors duration-300 focus-within:border-accent"
		>
			{#each interests as t}
				<span
					class="flex items-center gap-1 rounded-full border border-line bg-panel px-3 py-1 text-[13px] text-ink"
				>
					{t}
					<button
						type="button"
						onclick={() => removeInterest(t)}
						class="text-[15px] leading-none text-faint transition-colors hover:text-accent"
						aria-label="remove {t}"
					>&times;</button>
				</span>
			{/each}
			<input
				id="p-interests"
				class="min-w-[100px] flex-1 border-none bg-transparent px-1 py-1 text-[14px] text-ink outline-none placeholder:text-mute"
				bind:value={interestInput}
				onkeydown={(e) => { if (e.key === 'Enter') e.preventDefault(), addInterest(); }}
				placeholder={interests.length ? '' : 'add an interest…'}
			/>
		</div>

		<label class="eyebrow mt-6" for="p-about">more about me</label>
		<textarea id="p-about" rows="4" bind:value={about} placeholder="tell people more about yourself — what you're into, what you're building…"></textarea>

		<div class="mt-6 flex gap-4">
			<div class="flex-1">
				<label class="eyebrow" for="p-age">age</label>
				<input id="p-age" type="number" bind:value={age} placeholder="—" />
			</div>
			<div class="flex-1">
				<span class="eyebrow" id="p-gender-label">gender</span>
				<Select
					bind:value={gender}
					aria-label="gender"
					placeholder="—"
					options={[
						{ value: 'm', label: 'male' },
						{ value: 'f', label: 'female' },
						{ value: 'o', label: 'other' }
					]}
				/>
			</div>
		</div>

		<label class="eyebrow mt-6" for="p-country">location</label>
		<div id="p-country">
			<LocationPicker bind:country bind:region bind:city anyLabel="country" />
		</div>

		<label class="eyebrow mt-6" for="p-whatsapp">whatsapp number (optional)</label>
		<PhoneInput
			value={whatsapp}
			defaultCountry={country}
			onChange={(v) => (whatsapp = v)}
		/>

		<div class="mt-8 flex items-center gap-4">
			<button class="btn btn-amber" type="submit">save card</button>
			{#if saved}<span class="text-[13px] tracking-[0.04em] text-accent">saved</span>{/if}
		</div>
	</form>
	<div class="mt-7 rounded-[12px] border border-line bg-panel px-5 py-4">
		<p class="text-[13.5px] leading-[1.6] text-ink-soft">
			your <em class="italic text-ink">about</em>, <em class="italic text-ink">interests</em> +
			username are embedded into a semantic fingerprint — so others find you by
			<span class="text-ink">the shape of what you're about</span>, not just a keyword.
		</p>
	</div>

	<div class="card mt-6">
		<div class="eyebrow mb-3">credits</div>
		<p class="text-[14px] text-ink">
			{credit_balance === null ? '—' : `₦${(credit_balance / 100).toFixed(2)}`}
			<span class="text-[12px] text-mute">(5400 free every day)</span>
		</p>
		<div class="mt-3 flex flex-wrap gap-2">
			{#each [10000, 50000, 100000] as amount}
				<button class="btn text-[13px]" disabled={buying} onclick={() => buy_credits(amount)}>
					+ ₦{amount / 100}
				</button>
			{/each}
		</div>
	</div>

	{#if data.partner_code}
		<div class="card mt-6">
			<div class="eyebrow mb-3">invite link</div>
			<p class="text-[13.5px] leading-[1.6] text-ink-soft">
				share this — when someone signs up and buys credits, you get 54% back as credits.
			</p>
			<p class="mt-3 break-all font-mono text-[13px] text-ink">
				{page.url.origin}/i/{data.partner_code}
			</p>
			<p class="mt-2 text-[12px] text-mute">code · {data.partner_code}</p>
		</div>
	{/if}
</section>
