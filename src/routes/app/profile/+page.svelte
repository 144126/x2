<script lang="ts">
	import type { User } from '$lib/types';
	import LocationPicker from '$lib/LocationPicker.svelte';
	import PhoneInput from '$lib/PhoneInput.svelte';
	let { data } = $props();
	let p = $state(data.p as User);

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
	<div class="eyebrow">your studio card</div>
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
				<label class="eyebrow" for="p-gender">gender</label>
				<select id="p-gender" bind:value={gender}>
					<option value="">—</option>
					<option value="m">male</option>
					<option value="f">female</option>
					<option value="o">other</option>
				</select>
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
</section>
