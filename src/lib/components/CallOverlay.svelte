<script lang="ts">
	import CallTile from './CallTile.svelte';
	import {
		Mic,
		MicOff,
		Video,
		VideoOff,
		PhoneOff,
		Phone,
		Minimize2,
		Maximize2,
		PictureInPicture2,
		SkipForward
	} from '@lucide/svelte';

	type Peer = { uid: string; name: string; stream: MediaStream | null };

	let {
		phase,
		title,
		subtitle = '',
		peers,
		local = null,
		micOn = true,
		videoOn = false,
		canVideo = true,
		error = '',
		nextLabel = '',
		onaccept,
		ondecline,
		onhangup,
		ontogglemic,
		ontogglevideo,
		onnext
	}: {
		phase: 'calling' | 'ringing' | 'connected';
		title: string;
		subtitle?: string;
		peers: Peer[];
		local?: MediaStream | null;
		micOn?: boolean;
		videoOn?: boolean;
		canVideo?: boolean;
		error?: string;
		nextLabel?: string;
		onaccept?: () => void;
		ondecline?: () => void;
		onhangup: () => void;
		ontogglemic?: () => void;
		ontogglevideo?: () => void;
		onnext?: () => void;
	} = $props();

	let small = $state(false);
	let started = $state(0);
	let now = $state(Date.now());
	let stage: HTMLDivElement | undefined = $state();

	$effect(() => {
		if (phase === 'connected' && !started) started = Date.now();
	});

	$effect(() => {
		if (phase !== 'connected') return;
		const id = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(id);
	});

	let elapsed = $derived(started ? Math.floor((now - started) / 1000) : 0);
	let clock = $derived(
		[Math.floor(elapsed / 3600), Math.floor((elapsed % 3600) / 60), elapsed % 60]
			.slice(elapsed >= 3600 ? 0 : 1)
			.map((n, i) => (i === 0 && elapsed < 3600 ? String(n) : String(n).padStart(2, '0')))
			.join(':')
	);
	let status = $derived(
		phase === 'calling' ? 'calling…' : phase === 'ringing' ? 'incoming call' : clock
	);

	let grid = $derived(
		peers.length <= 1
			? 'grid-cols-1'
			: peers.length === 2
				? 'grid-cols-1 sm:grid-cols-2'
				: 'grid-cols-2'
	);

	// drag the local preview anywhere on screen, the way every call app lets you
	let dx = $state(0);
	let dy = $state(0);
	let drag: { x: number; y: number; ox: number; oy: number } | null = null;

	function grab(e: PointerEvent) {
		drag = { x: e.clientX, y: e.clientY, ox: dx, oy: dy };
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}
	function move(e: PointerEvent) {
		if (!drag) return;
		dx = drag.ox + e.clientX - drag.x;
		dy = drag.oy + e.clientY - drag.y;
	}
	function drop() {
		drag = null;
	}

	// the first video in the stage is the person you are looking at — that is the one that
	// pops out into the browser's own picture-in-picture window
	async function pip() {
		const video = stage?.querySelector('video');
		if (!video) return;
		if (document.pictureInPictureElement) await document.exitPictureInPicture().catch(() => {});
		else await video.requestPictureInPicture?.().catch(() => {});
	}

	function keys(e: KeyboardEvent) {
		if (e.key === 'Escape' && phase === 'connected' && !small) small = true;
	}
</script>

<svelte:window onkeydown={keys} />

{#if phase === 'ringing'}
	<div class="fixed inset-0 z-50 flex flex-col items-center justify-center gap-8 bg-base/98">
		<div class="flex flex-col items-center gap-3">
			<div
				class="flex h-24 w-24 items-center justify-center rounded-full border border-line-2 bg-panel-solid font-display text-[36px] text-ink-soft"
			>
				{(title || '?').slice(0, 1).toLowerCase()}
			</div>
			<h2 class="display text-[26px]">{title}</h2>
			<p class="eyebrow animate-pulse">incoming call</p>
		</div>
		<div class="flex items-center gap-10">
			<button class="ctl ctl-end" onclick={ondecline} aria-label="decline">
				<PhoneOff size={22} />
			</button>
			<button
				class="ctl border-transparent bg-emerald-500 text-white hover:bg-emerald-400"
				onclick={onaccept}
				aria-label="answer"
			>
				<Phone size={22} />
			</button>
		</div>
	</div>
{:else if small}
	<div
		class="fixed bottom-3 right-3 z-50 w-[152px] overflow-hidden rounded-[14px] border border-line-2 bg-panel-solid shadow-2xl max-sm:bottom-[calc(58px+env(safe-area-inset-bottom))]"
	>
		<CallTile
			stream={peers[0]?.stream ?? null}
			name={peers[0]?.name ?? title}
			showName={false}
			class="h-[96px] w-full"
		/>
		<div class="hidden">
			{#each peers.slice(1) as p (p.uid)}
				<CallTile stream={p.stream} showName={false} class="h-0 w-0" />
			{/each}
		</div>
		<div class="flex items-center gap-1 px-2 py-1.5">
			<span class="min-w-0 flex-1 truncate text-[11px] text-ink-soft">{status}</span>
			<button
				class="text-mute hover:text-ink"
				onclick={() => (small = false)}
				aria-label="expand call"><Maximize2 size={13} /></button
			>
			<button class="text-danger" onclick={onhangup} aria-label="hang up"
				><PhoneOff size={14} /></button
			>
		</div>
	</div>
{:else}
	<div class="fixed inset-0 z-50 flex flex-col bg-base">
		<header class="flex shrink-0 items-center gap-3 px-4 py-3">
			<button
				class="text-mute transition-colors hover:text-ink"
				onclick={() => (small = true)}
				aria-label="minimize call"><Minimize2 size={16} /></button
			>
			<div class="min-w-0">
				<div class="truncate font-display text-[16px]">{title}</div>
				<div class="truncate text-[11px] tabular-nums text-mute">
					{status}{subtitle ? ` · ${subtitle}` : ''}
				</div>
			</div>
			<button
				class="ml-auto text-mute transition-colors hover:text-ink"
				onclick={pip}
				aria-label="picture in picture"><PictureInPicture2 size={16} /></button
			>
		</header>

		{#if error}
			<p class="shrink-0 px-4 pb-2 text-[12px] text-danger">{error}</p>
		{/if}

		<div class="grid min-h-0 flex-1 gap-1.5 px-1.5 {grid}" bind:this={stage}>
			{#each peers as p (p.uid)}
				<CallTile
					stream={p.stream}
					name={p.name}
					showName={peers.length > 1}
					class="h-full w-full rounded-[14px]"
				/>
			{/each}
			{#if !peers.length}
				<CallTile
					stream={null}
					name={title}
					showName={false}
					class="h-full w-full rounded-[14px]"
				/>
			{/if}
		</div>

		{#if local}
			<div
				class="absolute right-3 top-16 h-[132px] w-[99px] cursor-grab touch-none overflow-hidden rounded-[14px] border border-line-2 shadow-xl active:cursor-grabbing"
				style="transform: translate({dx}px, {dy}px)"
				role="button"
				tabindex="0"
				aria-label="your camera preview — drag to move"
				onpointerdown={grab}
				onpointermove={move}
				onpointerup={drop}
				onpointercancel={drop}
			>
				<CallTile stream={local} muted mirror showName={false} name="you" class="h-full w-full" />
			</div>
		{/if}

		<div
			class="flex shrink-0 items-center justify-center gap-3.5 px-4 py-5 pb-[calc(20px+env(safe-area-inset-bottom))]"
		>
			<button
				class="ctl {micOn ? '' : 'ctl-off'}"
				onclick={ontogglemic}
				aria-label={micOn ? 'mute microphone' : 'unmute microphone'}
			>
				{#if micOn}<Mic size={20} />{:else}<MicOff size={20} />{/if}
			</button>
			{#if canVideo}
				<button
					class="ctl {videoOn ? '' : 'ctl-off'}"
					onclick={ontogglevideo}
					aria-label={videoOn ? 'turn camera off' : 'turn camera on'}
				>
					{#if videoOn}<Video size={20} />{:else}<VideoOff size={20} />{/if}
				</button>
			{/if}
			{#if nextLabel}
				<button class="ctl" onclick={onnext} aria-label={nextLabel} title={nextLabel}>
					<SkipForward size={20} />
				</button>
			{/if}
			<button class="ctl ctl-end" onclick={onhangup} aria-label="hang up">
				<PhoneOff size={20} />
			</button>
		</div>
	</div>
{/if}
