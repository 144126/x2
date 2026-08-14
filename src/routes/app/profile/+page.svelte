<script lang="ts">
	import { onMount } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import type { User } from '$lib/types';
	import LocationPicker from '$lib/LocationPicker.svelte';
	import PhoneInput from '$lib/PhoneInput.svelte';
	import Select from '$lib/components/Select.svelte';
	import { push_state, enable_push, disable_push } from '$lib/push-client';
	import { phone_length_error } from '$lib/phone';
	import { detect_location } from '$lib/geo-client';
	let { data } = $props();
	let p = $state(data.p as User);

	let credit_balance = $state<number | null>(null);
	let buying = $state(false);
	let pushState = $state<'on' | 'off' | 'blocked' | 'unsupported'>('off');
	let pushLoaded = $state(false);
	let key = $state('');

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

	onMount(async () => {
		load_credits();
		const [state, keyRes] = await Promise.all([
			push_state(),
			fetch('/api/push')
				.then((r) => (r.ok ? (r.json() as Promise<{ key: string }>) : null))
				.catch(() => null)
		]);
		pushState = state;
		key = keyRes?.key ?? '';
		pushLoaded = true;
	});

	let about = $state(p.a ?? '');
	let username = $state(p.u ?? '');
	let interests = $state<string[]>(p.i ?? []);
	let interestInput = $state('');
	let showInterests = $state(p.si ?? false);
	let age = $state(p.ag ?? '');
	let gender = $state(p.r ?? '');
	let country = $state(p.co ?? '');
	let region = $state(p.st ?? '');
	let city = $state(p.ci ?? '');

	// runs once, at init, on purpose: as an $effect this read `country` and wrote it, so
	// clearing a location refilled it from the IP guess on the same tick. It also guards on
	// the stored value, not the local one — an absent key means never set, '' means the user
	// cleared it on purpose, and only the first of those wants a guess.
	if (data.geo) {
		if (p.co === undefined && data.geo.country) country = data.geo.country;
		if (p.st === undefined && data.geo.region) region = data.geo.region;
		if (p.ci === undefined && data.geo.city) city = data.geo.city;
	}

	let whatsapp = $state(p.w ?? '');
	let saved = $state(false);
	let locating = $state(false);
	let locationWarning = $state<string | null>(null);

	let linkEmail = $state('');
	let linkPassword_ = $state('');
	let linking = $state(false);
	let linkError = $state('');
	let linkOk = $state(false);

	async function linkPassword() {
		linkError = '';
		linkOk = false;
		linking = true;
		const res = await fetch('/api/auth/set-password', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ email: linkEmail, password: linkPassword_ })
		});
		linking = false;
		if (res.ok) {
			linkOk = true;
			linkPassword_ = '';
			await invalidateAll();
		} else if (res.status === 409) {
			linkError = 'that email is already in use — try logging in instead.';
		} else {
			linkError = 'could not link — check your email and try again.';
		}
	}

	$effect(() => {
		if (!data.geo) {
			locationWarning = null;
			return;
		}
		const ipCountry = data.geo.country;
		const ipRegion = data.geo.region;
		const ipCity = data.geo.city;
		if (!ipCountry) {
			locationWarning = null;
			return;
		}
		const filled = country || region || city;
		if (!filled) {
			locationWarning = null;
			return;
		}
		const mismatch =
			(country && ipCountry && country !== ipCountry) ||
			(region && ipRegion && region !== ipRegion) ||
			(city && ipCity && city !== ipCity);
		if (!mismatch) {
			locationWarning = null;
			return;
		}
		locationWarning = `IP shows ${[ipCity, ipRegion, ipCountry].filter(Boolean).join(', ')} — use it?`;
	});

	async function useLocation() {
		locating = true;
		const loc = await detect_location();
		locating = false;
		if (!loc) return;
		if (loc.country) country = loc.country;
		if (loc.region) region = loc.region;
		if (loc.city) city = loc.city;
		locationWarning = null;
	}

	function addInterest() {
		const t = interestInput.trim();
		if (t && !interests.includes(t)) interests = [...interests, t];
		interestInput = '';
	}

	function removeInterest(t: string) {
		interests = interests.filter((i) => i !== t);
	}

	let phone_error = $state<string | null>(null);

	async function save() {
		saved = false;
		phone_error = whatsapp ? phone_length_error(whatsapp, country || null) : null;
		if (phone_error) return;
		const res = await fetch('/api/profile', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				about,
				username,
				interests,
				show_interests: showInterests,
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
	<h1 class="display mt-3 mb-6 text-[clamp(24px,4vw,34px)]">
		{username || p.m?.split('@')[0] || 'profile'}
	</h1>

	<a
		href="/app/user/{data.id}"
		class="text-[13px] -mt-5 mb-6 block w-fit text-accent underline underline-offset-4 decoration-accent/40 hover:decoration-accent transition-all"
		>view profile</a
	>

	<form onsubmit={(e) => (e.preventDefault(), save())} class="flex flex-col gap-2">
		<label class="eyebrow mt-4" for="p-username">username</label>
		<input id="p-username" bind:value={username} placeholder="display handle" />

		<label class="eyebrow mt-4" for="p-interests">interests</label>
		<div
			class="flex min-h-[38px] flex-wrap items-center gap-2 rounded-[10px] border border-line bg-panel-solid px-3 py-2 transition-colors duration-300 focus-within:border-accent"
		>
			{#each interests as t}
				<span
					class="flex items-center gap-1 rounded-full border border-line bg-panel px-3 py-1 text-[13px] text-ink"
				>
					{t}
					<button
						type="button"
						onclick={() => removeInterest(t)}
						class="text-[13.5px] leading-none text-faint transition-colors hover:text-accent"
						aria-label="remove {t}">&times;</button
					>
				</span>
			{/each}
			<input
				id="p-interests"
				class="min-w-[100px] flex-1 border-none bg-transparent px-1 py-1 text-[13px] text-ink outline-none placeholder:text-mute"
				bind:value={interestInput}
				onkeydown={(e) => {
					if (e.key === 'Enter') (e.preventDefault(), addInterest());
				}}
				placeholder={interests.length ? '' : 'add an interest…'}
			/>
		</div>
		<label class="mt-3 flex cursor-pointer items-center gap-2.5 text-[13.5px] text-ink-soft">
			<input type="checkbox" class="!w-auto accent-accent" bind:checked={showInterests} />
			show interests on my public profile
		</label>

		<label class="eyebrow mt-4" for="p-about">more about me</label>
		<textarea
			id="p-about"
			rows="4"
			bind:value={about}
			placeholder="tell people more about yourself — what you're into, what you're building…"
		></textarea>

		<div class="mt-4 flex gap-3">
			<div class="flex-1">
				<label class="eyebrow" for="p-age">age</label>
				<input id="p-age" type="number" bind:value={age} placeholder="—" />
			</div>
			<div class="flex-1">
				<span class="eyebrow" id="p-gender-label">gender</span>
				<Select
					bind:value={gender}
					aria-label="gender"
					placeholder="not set"
					options={[
						{ value: 'm', label: 'male' },
						{ value: 'f', label: 'female' },
						{ value: 'o', label: 'other' }
					]}
				/>
			</div>
		</div>

		<label class="eyebrow mt-4" for="p-country">location</label>
		<div id="p-country">
			<LocationPicker bind:country bind:region bind:city anyLabel="no country" />
		</div>
		<div class="flex items-center gap-3 mt-2">
			<button class="btn text-[12px]" onclick={useLocation} disabled={locating}>
				{locating ? 'detecting…' : 'use my location'}
			</button>
			{#if locationWarning}
				<button class="text-[12px] text-accent underline cursor-pointer" onclick={useLocation}>
					{locationWarning}
				</button>
			{/if}
		</div>

		<label class="eyebrow mt-4" for="p-whatsapp">whatsapp number (optional)</label>
		<PhoneInput value={whatsapp} defaultCountry={country} onChange={(v) => (whatsapp = v)} />
		{#if phone_error}
			<p class="mt-1 text-[12pxpx] text-accent">{phone_error}</p>
		{/if}

		<div class="mt-5 flex items-center gap-3">
			<button class="btn btn-amber" type="submit">save card</button>
			{#if saved}<span class="text-[13px] tracking-[0.04em] text-accent">saved</span>{/if}
		</div>
	</form>
	<div class="mt-4 rounded-[10px] border border-line bg-panel px-5 py-2.5">
		<p class="text-[13.5px] leading-[1.55] text-ink-soft">
			your <em class="italic text-ink">about</em>, <em class="italic text-ink">interests</em> +
			username are embedded into a semantic fingerprint — so others find you by
			<span class="text-ink">the shape of what you're about</span>, not just a keyword.
		</p>
	</div>

	<div class="card mt-4">
		<div class="eyebrow mb-3">credits</div>
		<p class="text-[13px] text-ink">
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

	<div class="card mt-4">
		<div class="eyebrow mb-3">notifications</div>

		{#if data.mutes?.length}
			<p class="text-[13px] text-mute mb-2 mt-3">muted</p>
			<div class="flex flex-col gap-2">
				{#each data.mutes as mute (mute.target)}
					<div
						class="flex items-center justify-between gap-2 rounded-[10px] border border-line bg-panel-solid px-3 py-2"
					>
						<span class="text-[13px] text-ink">{mute.name}</span>
						<div class="flex items-center gap-3">
							{#if mute.until}
								<span class="text-[11px] text-mute"
									>until {new Date(mute.until).toLocaleDateString()}</span
								>
							{/if}
							<button
								class="btn text-[12px]"
								aria-label="unmute {mute.name}"
								onclick={async () => {
									const r = await fetch(`/api/mute?target=${mute.target}`, { method: 'DELETE' });
									if (r.ok) data.mutes = data.mutes.filter((m) => m.target !== mute.target);
								}}>unmute</button
							>
						</div>
					</div>
				{/each}
			</div>
		{:else}
			<p class="text-[13px] text-mute">nothing muted.</p>
		{/if}

		<div class="flex items-center justify-between mt-4">
			<span class="text-[13px] text-ink">push notifications</span>
			{#if pushLoaded}
				{#if pushState === 'on'}
					<button class="btn" onclick={() => disable_push().then(() => (pushState = 'off'))}
						>disable</button
					>
				{:else if pushState === 'off'}
					<button
						class="btn"
						onclick={() =>
							enable_push(key).then((r) => {
								if (r.ok) pushState = 'on';
							})}>enable</button
					>
				{:else if pushState === 'blocked'}
					<span class="text-[11px] text-mute">notifications are blocked by your browser</span>
				{:else}
					<span class="text-[11px] text-mute">notifications are not supported by your browser</span>
				{/if}
			{/if}
		</div>
	</div>

	{#if data.partner_code}
		<div class="card mt-4">
			<div class="eyebrow mb-3">invite link</div>
			<p class="text-[13.5px] leading-[1.55] text-ink-soft">
				share this — when someone signs up and buys credits, you get 54% back as credits.
			</p>
			<p class="mt-3 break-all font-mono text-[13px] text-ink">
				{page.url.origin}/i/{data.partner_code}
			</p>
			<p class="mt-2 text-[12px] text-mute">code · {data.partner_code}</p>
		</div>
	{/if}

	{#if data.user?.is_device}
		<section id="link-account" class="mt-4 border-t border-line pt-8">
			<div class="eyebrow">link your account</div>
			<p class="mt-2 text-[13.5px] text-ink-soft">
				you're on a temporary account tied to this device. link google or set a password so you can
				log in from anywhere and never lose your rooms.
			</p>
			<a
				href="/google"
				class="btn btn-amber mt-4 inline-flex items-center gap-1.5 px-4 py-2 text-[13px]"
			>
				continue with google
			</a>
			<form
				class="mt-4 flex max-w-[360px] flex-col gap-2"
				onsubmit={(e) => (e.preventDefault(), linkPassword())}
			>
				<input type="email" bind:value={linkEmail} placeholder="email" />
				<input
					type="password"
					bind:value={linkPassword_}
					placeholder="password (min 6 characters)"
					minlength="6"
				/>
				<button class="btn px-4 py-2 text-[13px]" type="submit" disabled={linking}>
					{linking ? 'saving…' : 'set password'}
				</button>
				{#if linkError}<p class="text-[13px] text-red-400">{linkError}</p>{/if}
				{#if linkOk}<p class="text-[13px] text-accent">
						linked — you can now log in from any device.
					</p>{/if}
			</form>
		</section>
	{/if}
</section>
