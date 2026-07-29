<script lang="ts">
	import { onMount } from 'svelte';
	import { push_available, push_state, enable_push } from '$lib/push-client';
	import { has_sent } from '$lib/notify-trigger';
	import { ios_hint_needed, dismiss_install, install_hidden } from '$lib/install';
	import X from '@lucide/svelte/icons/x';

	let { vapid_key }: { vapid_key: string } = $props();

	let visible = $state(false);
	let ios_hint = $state(false);
	let busy = $state(false);
	let android_battery_hint = $state(false);

	onMount(async () => {
		if (!has_sent() || install_hidden()) return;
		if (ios_hint_needed()) {
			ios_hint = true;
			visible = true;
			return;
		}
		const avail = push_available();
		if (!avail.ok) return;
		if ((await push_state()) === 'off') visible = true;
	});

	async function enable() {
		busy = true;
		await enable_push(vapid_key);
		busy = false;
		// some Android OEMs (Xiaomi/Huawei/Samsung) aggressively kill background activity —
		// an app-code fix doesn't exist for this, so we just point people at the setting
		if (/Android/.test(navigator.userAgent)) {
			android_battery_hint = true;
		} else {
			visible = false;
		}
	}

	function dismiss() {
		dismiss_install();
		visible = false;
	}
</script>

{#if visible}
	<div
		class="fixed inset-x-4 bottom-[calc(84px+env(safe-area-inset-bottom))] z-20 flex items-center justify-between gap-4 rounded-lg border border-line bg-base/95 px-4 py-3 text-[13px] shadow-lg backdrop-blur-md sm:bottom-6 sm:left-auto sm:w-96"
	>
		{#if android_battery_hint}
			<p class="text-ink-soft">
				Notifications are on. Some phones aggressively limit background apps to save
				battery — if messages stop arriving, check your phone's battery settings and
				allow x2 (or your browser) to run in the background.
			</p>
		{:else if ios_hint}
			<p class="text-ink-soft">
				To get notified of new messages, add x2 to your home screen: tap
				<strong>Share</strong> → <strong>Add to Home Screen</strong>.
			</p>
		{:else}
			<p class="text-ink-soft">Turn on notifications so you never miss a message.</p>
			<button
				class="shrink-0 text-[11px] uppercase tracking-[0.18em] text-accent"
				disabled={busy}
				onclick={enable}
			>
				enable
			</button>
		{/if}
		<button class="shrink-0 text-mute" onclick={dismiss} aria-label="dismiss">
			<X size={16} />
		</button>
	</div>
{/if}
