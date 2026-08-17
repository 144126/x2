<script lang="ts">
	import { onMount } from 'svelte';
	import { Delete, LockKeyhole } from '@lucide/svelte';
	import { MIN, MAX } from '$lib/pin-limits';

	let { data } = $props();

	const PAD =
		'flex h-[58px] items-center justify-center rounded-[14px] border border-line bg-panel text-[19px] text-ink transition-colors duration-200 hover:not-disabled:border-line-2 hover:not-disabled:bg-panel-solid disabled:text-faint';

	let pin = $state('');
	let msg = $state('');
	let busy = $state(false);
	let forgot = $state(false);
	let password = $state('');
	let wait = $state(data.wait);
	let left = $state(data.left);

	// one dot per digit typed — the pin's length is never shown up front, so a stranger cannot
	// read how long it is off the screen
	let dots = $derived(Array.from({ length: pin.length }, (_, i) => i));
	let held = $derived(wait > 0);
	let ready = $derived(pin.length >= MIN && !busy && !held);
	let countdown = $derived(
		wait >= 60_000 ? `${Math.ceil(wait / 60_000)}m` : `${Math.ceil(wait / 1000)}s`
	);

	onMount(() => {
		const t = setInterval(() => {
			if (wait > 0) wait = Math.max(0, wait - 1000);
		}, 1000);
		return () => clearInterval(t);
	});

	function tap(d: string) {
		if (held || pin.length >= MAX) return;
		msg = '';
		pin += d;
	}

	function back() {
		msg = '';
		pin = pin.slice(0, -1);
	}

	function key(e: KeyboardEvent) {
		if (forgot) return;
		if (/^\d$/.test(e.key)) tap(e.key);
		else if (e.key === 'Backspace') back();
		else if (e.key === 'Enter' && ready) unlock();
	}

	async function unlock() {
		busy = true;
		const res = await fetch('/api/pin/unlock', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ pin })
		});
		busy = false;
		pin = '';
		if (res.status === 401) return location.assign('/login');
		const body = (await res.json().catch(() => ({}))) as {
			ok?: boolean;
			wait?: number;
			left?: number;
		};
		if (body.ok) return location.assign(data.r);
		wait = body.wait ?? 0;
		left = body.left ?? left;
		msg = wait ? 'too many tries' : left ? `wrong pin · ${left} left` : 'wrong pin';
	}

	async function reset_with_password(e: Event) {
		e.preventDefault();
		busy = true;
		const res = await fetch('/api/pin/reset', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ password })
		});
		busy = false;
		password = '';
		if (res.ok) return location.assign('/me#pin');
		const body = (await res.json().catch(() => ({}))) as { wait?: number };
		wait = body.wait ?? wait;
		msg = 'wrong password';
	}
</script>

<svelte:window onkeydown={key} />

<section class="mx-auto flex min-h-[80vh] max-w-[300px] flex-col items-center justify-center">
	<LockKeyhole size={20} class="text-mute" />
	<h1 class="display mt-4 text-[22px]">locked</h1>

	{#if forgot}
		<p class="mt-3 text-center text-[13px] leading-[1.6] text-ink-soft">
			sign in again and the pin comes off.
		</p>
		{#if data.has_google}
			<a class="btn btn-amber mt-5 w-full" href="/google?reset=pin">continue with google</a>
		{/if}
		{#if data.has_pw}
			<form class="mt-3 flex w-full flex-col gap-2" onsubmit={reset_with_password}>
				<input
					type="password"
					bind:value={password}
					placeholder="your account password"
					autocomplete="current-password"
				/>
				<button class="btn w-full" type="submit" disabled={busy || !password}>remove pin</button>
			</form>
		{/if}
		<button
			class="mt-5 bg-none p-0 text-[12.5px] text-mute hover:text-ink"
			onclick={() => (forgot = false)}
		>
			back to pin
		</button>
	{:else}
		<p class="mt-3 text-[13px] text-ink-soft">enter your pin</p>

		<div class="mt-6 flex h-3 items-center gap-2">
			{#each dots as i (i)}
				<span class="h-2 w-2 rounded-full bg-ink"></span>
			{/each}
			{#if !pin}<span class="h-2 w-2 rounded-full bg-faint"></span>{/if}
		</div>

		<p class="mt-4 h-4 text-[12.5px] text-danger">
			{held ? `too many tries · wait ${countdown}` : msg}
		</p>

		<div class="mt-2 grid w-full grid-cols-3 gap-2.5">
			{#each ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as d (d)}
				<button class={PAD} onclick={() => tap(d)} disabled={held}>{d}</button>
			{/each}
			<span></span>
			<button class={PAD} onclick={() => tap('0')} disabled={held}>0</button>
			<button class={PAD} onclick={back} disabled={held} aria-label="delete">
				<Delete size={17} />
			</button>
		</div>

		<button class="btn btn-amber mt-5 w-full" onclick={unlock} disabled={!ready}>
			{busy ? 'checking…' : 'unlock'}
		</button>

		<button
			class="mt-5 bg-none p-0 text-[12.5px] text-mute hover:text-ink"
			onclick={() => (forgot = true)}
		>
			forgot pin?
		</button>
	{/if}

	<button
		class="mt-2 bg-none p-0 text-[12.5px] text-faint hover:text-mute"
		onclick={() => fetch('/logout', { method: 'POST' }).then(() => location.assign('/login'))}
	>
		sign out
	</button>
</section>
