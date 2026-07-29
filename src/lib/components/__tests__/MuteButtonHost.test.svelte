<script lang="ts">
	import MuteButton from '../MuteButton.svelte';

	let { target = 't1', kind = 'r' }: { target?: string; kind?: 'u' | 'r' } = $props();

	let muted = $state(false);
</script>

<MuteButton {target} {kind} bind:muted />
<span data-testid="muted">{String(muted)}</span>

{#if muted}
	<button onclick={() => (muted = false)}>reset</button>
{/if}
