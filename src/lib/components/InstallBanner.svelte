<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { watch_install, can_install, install, install_hidden, dismiss_install } from '$lib/install';
	import X from '@lucide/svelte/icons/x';

	let visible = $state(false);
	let off: (() => void) | null = null;
	let poll: ReturnType<typeof setInterval> | null = null;

	onMount(() => {
		off = watch_install();
		// beforeinstallprompt fires asynchronously; poll briefly rather than adding a second
		// event-driven path just for this one flag.
		poll = setInterval(() => {
			if (can_install() && !install_hidden()) visible = true;
		}, 1000);
	});

	onDestroy(() => {
		off?.();
		if (poll) clearInterval(poll);
	});

	async function do_install() {
		await install();
		visible = false;
	}

	function dismiss() {
		dismiss_install();
		visible = false;
	}
</script>

{#if visible}
	<div
		class="fixed inset-x-4 top-[calc(env(safe-area-inset-top)+12px)] z-20 flex items-center justify-between gap-4 rounded-lg border border-line bg-base/95 px-4 py-3 text-[13px] shadow-lg backdrop-blur-md sm:left-auto sm:right-6 sm:w-96"
	>
		<p class="text-ink-soft">Install x2 for a faster, full-screen experience.</p>
		<button class="shrink-0 text-[11px] uppercase tracking-[0.18em] text-accent" onclick={do_install}>
			install
		</button>
		<button class="shrink-0 text-mute" onclick={dismiss} aria-label="dismiss">
			<X size={16} />
		</button>
	</div>
{/if}
