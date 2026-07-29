<script lang="ts">
	import { Bell, BellOff } from '@lucide/svelte';
	import Modal from './Modal.svelte';

	let {
		target,
		kind,
		muted = $bindable(),
		label = 'notifications'
	}: { target: string; kind: 'u' | 'r'; muted?: boolean; label?: string } = $props();

	let open = $state(false);
	let busy = $state(false);

	const HOUR = 3600_000;
	const options = [
		{ label: '8 hours', ms: 8 * HOUR },
		{ label: '1 week', ms: 7 * 24 * HOUR },
		{ label: 'until i turn it back on', ms: 0 }
	];

	async function apply(ms: number) {
		busy = true;
		const res = await fetch('/api/mute', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ target, kind, until: ms ? Date.now() + ms : 0 })
		});
		busy = false;
		if (res.ok) {
			muted = true;
			open = false;
		}
	}

	async function off() {
		busy = true;
		const res = await fetch(`/api/mute?target=${encodeURIComponent(target)}`, { method: 'DELETE' });
		busy = false;
		if (res.ok) muted = false;
	}
</script>

<button
	class="btn flex items-center gap-1.5 px-3 py-2 text-[12px]"
	disabled={busy}
	onclick={() => (muted ? off() : (open = true))}
	aria-label={muted ? `unmute ${label}` : `mute ${label}`}
	title={muted ? 'unmute' : 'mute'}
>
	{#if muted}<BellOff size={14} />{:else}<Bell size={14} />{/if}
</button>

<Modal bind:open title="mute {label}">
	<div class="flex flex-col gap-2">
		{#each options as o (o.label)}
			<button class="btn justify-start text-[13px]" onclick={() => apply(o.ms)}>{o.label}</button>
		{/each}
	</div>
</Modal>
