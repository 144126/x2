<script lang="ts">
	let {
		stream,
		muted = false,
		class: cls = ''
	}: { stream: MediaStream | null; muted?: boolean; class?: string } = $props();

	// MUST be $state — a plain `let` never re-triggers the effect when bind:this lands,
	// which is exactly how remote audio silently never played before.
	let el: HTMLVideoElement | undefined = $state();

	$effect(() => {
		if (!el) return;
		el.srcObject = stream;
		// autoplay with audio is gesture-gated; the call button is that gesture, but a
		// rejected play() must never throw into the effect
		if (stream) el.play().catch(() => {});
	});
</script>

<!-- svelte-ignore a11y_media_has_caption -->
<video bind:this={el} autoplay playsinline {muted} class={cls}></video>
