<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { media_src } from '$lib/attach';
	import { media_error } from '$lib/call';
	import { prompt_of_the_day } from '$lib/prompts';
	import { Play, Pause, Mic, Square, Send, LoaderCircle, RotateCcw } from '@lucide/svelte';

	type Note = { id: string; f: string; k: string; name?: string; d: number };

	let { compact = false }: { compact?: boolean } = $props();

	const PROMPT = prompt_of_the_day();
	/** long enough to say something real, short enough that nobody rehearses */
	const MAX_MS = 30_000;

	let note = $state<Note | null>(null);
	let loading = $state(true);
	let playing = $state(false);
	let audio: HTMLAudioElement | undefined = $state();

	let rec: MediaRecorder | null = null;
	let chunks: Blob[] = [];
	let stream: MediaStream | null = null;
	let recording = $state(false);
	let left = $state(MAX_MS / 1000);
	let take = $state<Blob | null>(null);
	let sending = $state(false);
	let sent = $state(false);
	let err = $state('');
	let ticker: ReturnType<typeof setInterval> | null = null;

	async function load() {
		loading = true;
		const r = await fetch('/api/notes').catch(() => null);
		note = r?.ok ? ((await r.json()) as { n: Note | null }).n : null;
		loading = false;
	}

	function toggle() {
		if (!audio) return;
		if (playing) audio.pause();
		else audio.play().catch(() => (err = 'could not play that one'));
	}

	async function start_rec() {
		err = '';
		try {
			stream ??= await navigator.mediaDevices.getUserMedia({ audio: true });
		} catch (e) {
			err = media_error(e);
			return;
		}
		chunks = [];
		rec = new MediaRecorder(stream);
		rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
		rec.onstop = () => {
			take = new Blob(chunks, { type: rec?.mimeType || 'audio/webm' });
			recording = false;
			if (ticker) clearInterval(ticker);
			left = MAX_MS / 1000;
		};
		rec.start();
		recording = true;
		left = MAX_MS / 1000;
		ticker = setInterval(() => {
			left -= 1;
			if (left <= 0) stop_rec();
		}, 1000);
		setTimeout(() => recording && stop_rec(), MAX_MS);
	}

	function stop_rec() {
		if (rec?.state === 'recording') rec.stop();
	}

	function again() {
		take = null;
		err = '';
	}

	/** answering the pool leaves your own note; answering a person starts a thread */
	async function send() {
		if (!take) return;
		sending = true;
		err = '';
		try {
			if (note) {
				const body = new FormData();
				body.append('file', take, 'note.webm');
				const up = await fetch('/api/upload', { method: 'POST', body });
				if (!up.ok) throw new Error('upload');
				const file = await up.json();
				const res = await fetch('/api/send', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ to: note.f, file })
				});
				if (!res.ok) throw new Error('send');
			} else {
				const body = new FormData();
				body.append('audio', take, 'note.webm');
				const res = await fetch('/api/notes', { method: 'POST', body });
				if (!res.ok) throw new Error('note');
			}
			sent = true;
			take = null;
		} catch {
			err = 'that did not send — try again.';
		} finally {
			sending = false;
		}
	}

	async function next() {
		sent = false;
		take = null;
		await load();
	}

	onMount(load);
	onDestroy(() => {
		if (ticker) clearInterval(ticker);
		stop_rec();
		for (const t of stream?.getTracks() ?? []) t.stop();
	});
</script>

<div class="flex w-full max-w-[420px] flex-col items-center gap-3 text-center">
	{#if !compact}
		<div class="eyebrow">today's question</div>
		<p class="max-w-[26ch] font-display text-[clamp(16px,4.2vw,21px)] leading-[1.25]">{PROMPT}</p>
	{/if}

	{#if loading}
		<p class="flex items-center gap-2 text-[12.5px] text-mute">
			<LoaderCircle size={13} class="animate-spin" /> finding a voice…
		</p>
	{:else if sent}
		<div class="card flex w-full flex-col items-center gap-2">
			<p class="text-[13px] text-ink">
				{note ? `sent to ${note.name ?? 'them'} — they'll get a notification` : 'your answer is in'}
			</p>
			<button class="btn" onclick={next}>hear someone else</button>
		</div>
	{:else}
		{#if note}
			<div class="card flex w-full items-center gap-3 text-left">
				<button
					class="ctl h-11 w-11 shrink-0 border-accent/40 bg-accent-soft text-accent"
					onclick={toggle}
					aria-label={playing ? 'pause' : 'play'}
				>
					{#if playing}<Pause size={18} />{:else}<Play size={18} />{/if}
				</button>
				<div class="min-w-0 flex-1">
					<div class="truncate text-[13px] text-ink">{note.name ?? 'someone'}</div>
					<div class="text-[11px] text-mute">answered today's question</div>
				</div>
				<!-- svelte-ignore a11y_media_has_caption -->
				<audio
					bind:this={audio}
					src={media_src(note.k)}
					onplay={() => (playing = true)}
					onpause={() => (playing = false)}
					onended={() => (playing = false)}
				></audio>
			</div>
		{:else}
			<p class="text-[12.5px] text-mute">
				nobody has answered yet today. leave the first one and someone will hear it.
			</p>
		{/if}

		{#if take}
			<div class="flex items-center gap-2">
				<button class="btn" onclick={again} disabled={sending}>
					<RotateCcw size={13} /> redo
				</button>
				<button class="btn btn-amber" onclick={send} disabled={sending}>
					{#if sending}<LoaderCircle size={14} class="animate-spin" />{:else}<Send size={14} />{/if}
					{note ? 'send it to them' : 'add to the pool'}
				</button>
			</div>
		{:else if recording}
			<button class="btn btn-amber" onclick={stop_rec}>
				<Square size={13} /> stop · {left}s
			</button>
		{:else}
			<button class="btn" onclick={start_rec}>
				<Mic size={13} />
				{note ? 'answer them with your voice' : 'answer with your voice'}
			</button>
		{/if}

		{#if err}<p class="text-[12px] text-danger">{err}</p>{/if}
	{/if}
</div>
