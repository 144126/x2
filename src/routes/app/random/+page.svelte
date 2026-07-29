<script lang="ts">
	import { goto } from '$app/navigation';
	import { onDestroy } from 'svelte';
	import RadioGroup from '$lib/components/RadioGroup.svelte';
	import Shuffle from '@lucide/svelte/icons/shuffle';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';

	type Mode = 'text' | 'voice' | 'video';

	let mode = $state<Mode>('video');
	let phase = $state<'pick' | 'searching' | 'error'>('pick');
	let ws: WebSocket | null = null;

	function start() {
		phase = 'searching';
		fetch('/api/wstoken')
			.then((r) => r.json())
			.then((j) => {
				ws = new WebSocket(j.match);
				ws.onmessage = (ev) => {
					const m = JSON.parse(ev.data);
					if (m.type === 'matched') {
						ws?.close();
						goto(`/app/chat/${m.peer}?auto=${mode}`);
					}
					// 'searching' just confirms we're queued — nothing to do but wait.
				};
				ws.onerror = () => (phase = 'error');
				ws.onclose = () => {
					if (phase === 'searching') phase = 'error';
				};
			})
			.catch(() => (phase = 'error'));
	}

	function cancel() {
		ws?.close();
		ws = null;
		phase = 'pick';
	}

	onDestroy(() => ws?.close());
</script>

<section class="mx-auto max-w-[480px] reveal">
	<div class="eyebrow">discover</div>
	<h1 class="display mt-3 mb-9 text-[clamp(36px,6vw,56px)] leading-[0.98]">
		meet someone<br /><em class="italic text-accent">new</em>.
	</h1>

	{#if phase === 'pick'}
		<p class="mb-6 text-[14.5px] leading-[1.6] text-ink-soft">
			we match you with a stranger by vibe — closest interests first. text is always on;
			camera and mic are yours to toggle any time, even mid-call.
		</p>
		<RadioGroup
			bind:value={mode}
			options={[
				{ value: 'text', label: 'text only' },
				{ value: 'voice', label: 'voice + text' },
				{ value: 'video', label: 'video + text' }
			]}
		/>
		<button class="btn btn-amber mt-8 flex w-full items-center justify-center gap-2" onclick={start}>
			<Shuffle size={16} /> find someone
		</button>
	{:else if phase === 'searching'}
		<p class="flex items-center gap-2 text-[15px] text-ink-soft">
			<LoaderCircle size={16} class="animate-spin" /> looking for a kindred spirit…
		</p>
		<button class="btn btn-ghost mt-6" onclick={cancel}>cancel</button>
	{:else}
		<p class="text-[15px] text-[#e2674c]">couldn't reach the matching service — try again.</p>
		<button class="btn btn-amber mt-6" onclick={() => (phase = 'pick')}>back</button>
	{/if}
</section>
