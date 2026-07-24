<script lang="ts">
	import { goto } from '$app/navigation';

	let mode = $state<'login' | 'register'>('login');
	let email = $state('');
	let pw = $state('');
	let msg = $state('');

	async function submit(e: Event) {
		e.preventDefault();
		msg = '';
		const res = await fetch(`/api/auth/${mode}`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ e: email, p: pw })
		});
		if (res.ok) goto('/app');
		else
			msg =
				(await res.json().catch(() => ({}))).message ??
				(mode === 'login' ? 'bad credentials' : 'failed');
	}
</script>

<section class="wrap mx-auto mt-[16vh] max-w-[400px] reveal">
	<div class="eyebrow">x2 · {mode === 'login' ? 'sign in' : 'join'}</div>
	<h1 class="display mt-4 whitespace-pre-line text-[clamp(44px,8vw,72px)] leading-[0.96]">
		{mode === 'login' ? 'welcome\nback' : 'begin\nhere'}
	</h1>

	<a class="btn btn-amber mt-9 w-full" href="/google">continue with google</a>

	<div class="my-7 flex items-center gap-3.5 text-[11px] uppercase tracking-[0.24em] text-faint">
		<span class="h-px flex-1 bg-line"></span>or<span class="h-px flex-1 bg-line"></span>
	</div>

	<form onsubmit={submit} class="flex flex-col gap-3.5">
		<input type="email" placeholder="email" bind:value={email} required />
		<input
			type="password"
			placeholder="password · min 6"
			bind:value={pw}
			required
			minlength="6"
		/>
		<button class="btn btn-amber mt-1.5 w-full" type="submit"
			>{mode === 'login' ? 'log in' : 'create'}</button
		>
	</form>

	{#if msg}<p class="mt-3.5 text-[13px] text-[#e2674c]">{msg}</p>{/if}

	<p class="mt-6 text-[13.5px] text-mute">
		{mode === 'login' ? 'new to the studio?' : 'already a member?'}
		<button
			class="bg-none p-0 text-accent underline-offset-[3px] hover:underline"
			onclick={() => (mode = mode === 'login' ? 'register' : 'login')}
		>
			{mode === 'login' ? 'create an account' : 'log in'}
		</button>
	</p>
</section>
