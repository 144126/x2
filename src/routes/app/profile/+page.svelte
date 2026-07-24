<script lang="ts">
	import type { User } from '$lib/types';
	let { data } = $props();
	let p = $state(data.p as User);

	let about = $state(p.a ?? '');
	let username = $state(p.u ?? '');
	let interests_text = $state((p.i ?? []).join(', '));
	let age = $state(p.ag ?? '');
	let gender = $state(p.r ?? '');
	let saved = $state(false);

	const to_tokens = (s: string) =>
		s
			.split(/[,\n]/)
			.map((t) => t.trim())
			.filter(Boolean);

	async function save() {
		saved = false;
		const res = await fetch('/api/profile', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				about,
				username,
				interests: to_tokens(interests_text),
				age: age ? Number(age) : undefined,
				gender
			})
		});
		saved = res.ok;
	}
</script>

<section class="prof reveal mx-auto max-w-[560px]">
	<div class="eyebrow">your studio card</div>
	<h1 class="display mt-3 mb-10 text-[clamp(40px,6vw,64px)]">{p.n ?? 'profile'}</h1>

	<form onsubmit={(e) => (e.preventDefault(), save())} class="flex flex-col gap-2">
		<label class="eyebrow mt-6" for="p-username">username</label>
		<input id="p-username" bind:value={username} placeholder="display handle" />

		<label class="eyebrow mt-6" for="p-interests">interests</label>
		<input
			id="p-interests"
			bind:value={interests_text}
			placeholder="ceramics, generative art, long walks"
		/>

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

		<div class="mt-8 flex items-center gap-4">
			<button class="btn btn-amber" type="submit">save changes</button>
			{#if saved}<span class="text-[13px] tracking-[0.04em] text-accent">saved</span>{/if}
		</div>
	</form>
	<p class="mt-7 max-w-[46ch] text-[13.5px] leading-[1.6] text-faint">
		your <em class="italic text-ink-soft">about</em>, <em class="italic text-ink-soft">interests</em> +
		username are embedded, so others find you by meaning — not just a keyword.
	</p>
</section>
