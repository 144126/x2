<script lang="ts">
	// One participant in a call. A video element always carries the stream (it plays the
	// audio even with no video track); when no picture arrives we cover it with an initial,
	// which is what an audio-only call looks like everywhere else.
	let {
		stream,
		name = '',
		muted = false,
		mirror = false,
		fit = 'cover',
		showName = true,
		class: cls = ''
	}: {
		stream: MediaStream | null;
		name?: string;
		muted?: boolean;
		mirror?: boolean;
		fit?: 'cover' | 'contain';
		showName?: boolean;
		class?: string;
	} = $props();

	// MUST be $state — a plain `let` never re-triggers the effect when bind:this lands,
	// which is exactly how remote audio silently never played before.
	let video: HTMLVideoElement | undefined = $state();
	let has_picture = $state(false);

	$effect(() => {
		if (!video) return;
		video.srcObject = stream;
		has_picture = false;
		// autoplay with audio is gesture-gated; the call button is that gesture, but a
		// rejected play() must never throw into the effect
		if (stream) video.play().catch(() => {});
	});

	// videoWidth is the only honest signal: a stream can carry a video track that never
	// produces frames, and tracks are added mid-call when someone turns their camera on
	const measure = () => (has_picture = !!video && video.videoWidth > 0);
</script>

<div class="relative overflow-hidden bg-black {cls}">
	<video
		bind:this={video}
		autoplay
		playsinline
		{muted}
		onloadedmetadata={measure}
		onresize={measure}
		onemptied={() => (has_picture = false)}
		class="h-full w-full {fit === 'cover' ? 'object-cover' : 'object-contain'} {mirror
			? '-scale-x-100'
			: ''} {has_picture ? '' : 'opacity-0'}"
	></video>

	{#if !has_picture}
		<div class="absolute inset-0 flex flex-col items-center justify-center gap-2.5">
			<div
				class="flex h-[clamp(52px,18%,104px)] w-[clamp(52px,18%,104px)] items-center justify-center rounded-full border border-line-2 bg-panel-solid font-display text-[clamp(20px,7vw,38px)] text-ink-soft"
			>
				{(name || '?').slice(0, 1).toLowerCase()}
			</div>
		</div>
	{/if}

	{#if showName && name}
		<span
			class="absolute bottom-1.5 left-1.5 max-w-[calc(100%-12px)] truncate rounded-full bg-black/55 px-2 py-0.5 text-[10.5px] text-ink backdrop-blur-sm"
			>{name}</span
		>
	{/if}
</div>
