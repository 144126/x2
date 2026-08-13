<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { LogIn, UserPlus } from '@lucide/svelte';

	const REF_KEY = 'ref_code';

	let mode = $state<'login' | 'register'>('login');
	let email = $state('');
	let pw = $state('');
	let msg = $state('');
	let ref_code = $state('');

	onMount(() => {
		const from_url = page.url.searchParams.get('c')?.trim().toLowerCase() ?? '';
		if (from_url) {
			localStorage.setItem(REF_KEY, from_url);
			// non-httpOnly so Google start can also read via query; server cookie set on /google?c=
			document.cookie = `ref_code=${encodeURIComponent(from_url)};path=/;max-age=${60 * 60 * 24 * 14};samesite=lax`;
			ref_code = from_url;
		} else {
			ref_code = localStorage.getItem(REF_KEY)?.trim().toLowerCase() ?? '';
		}
	});

	// ref_code is synced from localStorage in onMount (browser-only) — reading localStorage
	// again here would 500 on SSR, which runs this on the server for every logged-out visitor
	function google_href() {
		return ref_code ? `/google?c=${encodeURIComponent(ref_code)}` : '/google';
	}

	async function submit(e: Event) {
		e.preventDefault();
		msg = '';
		const c = ref_code;
		const res = await fetch(`/api/auth/${mode}`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(mode === 'register' ? { e: email, p: pw, c } : { e: email, p: pw })
		});
		if (res.ok) {
			if (mode === 'register') localStorage.removeItem(REF_KEY);
			goto('/app');
		} else
			msg =
				(await res.json().catch(() => ({}))).message ??
				(mode === 'login' ? 'bad credentials' : 'failed');
	}
</script>

<section class="reveal mx-auto mt-[8vh] max-w-[380px]">
	<div class="eyebrow">x2 · {mode === 'login' ? 'sign in' : 'join'}</div>
	<h1 class="display mt-4 whitespace-pre-line text-[clamp(26px,5vw,38px)] leading-[0.96]">
		{mode === 'login' ? 'welcome\nback' : 'begin\nhere'}
	</h1>
	<p class="mt-5 text-[13px] leading-[1.6] text-ink-soft">
		{mode === 'login'
			? 'your threads are waiting.'
			: "one card, matched by what you're into — not what you look like."}
	</p>

	<a class="btn btn-amber mt-5 w-full" href={google_href()}>continue with google</a>

	<div class="my-4 flex items-center gap-2.5 text-[11px] uppercase tracking-[0.24em] text-faint">
		<span class="h-px flex-1 bg-line"></span>or<span class="h-px flex-1 bg-line"></span>
	</div>

	<form onsubmit={submit} class="flex flex-col gap-2.5">
		<input type="email" placeholder="email" bind:value={email} required />
		<input type="password" placeholder="password · min 6" bind:value={pw} required minlength="6" />
		<button
			class="btn btn-amber mt-1.5 flex w-full items-center justify-center gap-2"
			type="submit"
		>
			{#if mode === 'login'}<LogIn size={16} />{:else}<UserPlus size={16} />{/if}
			{mode === 'login' ? 'log in' : 'create account'}
		</button>
	</form>

	{#if msg}<p class="mt-2 text-[13px] text-[#e2674c]">{msg}</p>{/if}

	<p class="mt-4 text-[13.5px] text-mute">
		{mode === 'login' ? 'new to x2?' : 'already a member?'}
		<button
			class="bg-none p-0 text-accent underline-offset-[3px] hover:underline"
			onclick={() => (mode = mode === 'login' ? 'register' : 'login')}
		>
			{mode === 'login' ? 'create an account' : 'log in'}
		</button>
	</p>
</section>
