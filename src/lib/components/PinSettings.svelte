<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { LockKeyhole } from '@lucide/svelte';
	import { MIN, MAX } from '$lib/pin-limits';

	let { pin }: { pin: { on: boolean; allowed: boolean } } = $props();

	let open = $state(false);
	let current = $state('');
	let next = $state('');
	let again = $state('');
	let busy = $state(false);
	let msg = $state('');

	const digits = (v: string) => v.replace(/\D/g, '').slice(0, MAX);

	function reset() {
		current = next = again = '';
		open = false;
	}

	async function save(e: Event) {
		e.preventDefault();
		msg = '';
		if (next.length < MIN) return (msg = `at least ${MIN} digits`);
		if (next !== again) return (msg = "the two pins don't match");
		busy = true;
		const res = await fetch('/api/pin', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ pin: next, current })
		});
		busy = false;
		if (res.ok) {
			reset();
			await invalidateAll();
		} else if (res.status === 403) msg = 'that is not your current pin';
		else if (res.status === 409) msg = 'connect google or set a password first';
		else msg = 'could not save';
	}

	async function remove() {
		msg = '';
		busy = true;
		const res = await fetch('/api/pin', {
			method: 'DELETE',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ current })
		});
		busy = false;
		if (res.ok) {
			reset();
			await invalidateAll();
		} else msg = res.status === 403 ? 'that is not your current pin' : 'could not remove';
	}
</script>

<div class="card mt-4" id="pin">
	<div class="eyebrow mb-3 flex items-center gap-1.5"><LockKeyhole size={11} /> app lock</div>

	{#if !pin.allowed}
		<p class="text-[13.5px] leading-[1.55] text-ink-soft">
			a pin needs an account you can sign back into, because signing in again is the only way past a
			pin you forget. connect google or set a password first.
		</p>
		<a href="#link-account" class="btn mt-3">link an account</a>
	{:else}
		<p class="text-[13.5px] leading-[1.55] text-ink-soft">
			{pin.on
				? 'this account asks for a pin every time it opens.'
				: `ask for a ${MIN}-${MAX} digit pin every time this account opens, on every device.`}
		</p>

		{#if pin.on && !open}
			<div class="mt-3 flex gap-2">
				<button class="btn" onclick={() => (open = true)}>change pin</button>
				<button class="btn" onclick={() => (open = true)}>turn off</button>
			</div>
		{:else if !open}
			<button class="btn btn-amber mt-3" onclick={() => (open = true)}>set a pin</button>
		{:else}
			<form class="mt-3 flex max-w-[300px] flex-col gap-2" onsubmit={save}>
				{#if pin.on}
					<input
						inputmode="numeric"
						autocomplete="off"
						placeholder="current pin"
						value={current}
						oninput={(e) => (current = digits(e.currentTarget.value))}
					/>
				{/if}
				<input
					inputmode="numeric"
					autocomplete="off"
					placeholder={pin.on ? 'new pin' : `pin · ${MIN}-${MAX} digits`}
					value={next}
					oninput={(e) => (next = digits(e.currentTarget.value))}
				/>
				<input
					inputmode="numeric"
					autocomplete="off"
					placeholder="repeat it"
					value={again}
					oninput={(e) => (again = digits(e.currentTarget.value))}
				/>
				<div class="flex gap-2">
					<button class="btn btn-amber" type="submit" disabled={busy}>
						{busy ? 'saving…' : pin.on ? 'change pin' : 'turn on'}
					</button>
					<button class="btn" type="button" onclick={reset}>cancel</button>
					{#if pin.on}
						<button class="btn ml-auto" type="button" onclick={remove} disabled={busy}>
							turn off
						</button>
					{/if}
				</div>
			</form>
			<p class="mt-3 text-[12px] leading-[1.55] text-mute">
				setting or changing the pin signs out every other device.
			</p>
		{/if}

		{#if msg}<p class="mt-2 text-[13px] text-danger">{msg}</p>{/if}
	{/if}
</div>
