<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { onMount, onDestroy } from 'svelte';
	import { ws_on, ws_send, ws_drop } from '$lib/ws';
	import { upload_file, media_src, image_from_event } from '$lib/attach';
	import { mark_first_send } from '$lib/notify-trigger';

	type FileAttach = { key: string; name: string; size: number; type: string };
	let { data } = $props();
	let messages = $state(
		data.messages as { id: string; f: string; x: string; im?: string; fl?: FileAttach; d: number }[]
	);
	function add_msg(m: { id: string; f: string; x: string; im?: string; fl?: FileAttach; d: number }) {
		if (messages.some((e) => e.id === m.id)) return;
		messages = [...messages, m];
	}
	let pendingFile: File | null = $state(null);
	let searchQ = $state('');
	let searchResults = $state<{ id: string; x: string; d: number }[] | null>(null);
	let searching = $state(false);

	async function searchThread() {
		const q = searchQ.trim();
		if (!q) {
			searchResults = null;
			return;
		}
		searching = true;
		const res = await fetch(`/api/search/messages?q=${encodeURIComponent(q)}&conv=${encodeURIComponent(data.peer)}`);
		searching = false;
		if (res.ok) searchResults = (await res.json()).messages;
	}
	let busy = $state(false);
	let text = $state('');
	let scheduleAt = $state('');
	let showSchedule = $state(false);
	let online = $state(false);
	let unsub: (() => void) | null = null;
	let me = $derived($page.data.user?.id);

	// present when we landed here from a random match (/app/random): 'text' | 'voice' | 'video'.
	// text always includes chat; voice/video auto-start a call the moment both sides connect.
	let auto = $derived($page.url.searchParams.get('auto') as 'text' | 'voice' | 'video' | null);
	let auto_tried = false;

	// ponytail: free Google STUN only — add TURN for symmetric NATs / prod
	let pc: RTCPeerConnection | null = $state(null);
	let localStream: MediaStream | null = $state(null);
	let remoteStream: MediaStream | null = $state(null);
	let callState = $state<'idle' | 'calling' | 'ringing' | 'connected'>('idle');
	let videoOn = $state(false);
	let micOn = $state(true);
	let pendingOffer: RTCSessionDescriptionInit | null = null;

	const stun = { urls: 'stun:stun.l.google.com:19302' };

	async function send() {
		const body = text.trim();
		if ((!body && !pendingFile) || busy) return;
		busy = true;
		let image: string | undefined;
		let file: FileAttach | undefined;
		if (pendingFile) {
			const r = await upload_file(pendingFile);
			if (r.error || !r.key) {
				busy = false;
				return;
			}
			// images stay inline-rendered (m.im); everything else renders as a download chip
			if (pendingFile.type.startsWith('image/')) image = r.key;
			else file = { key: r.key, name: r.name!, size: r.size!, type: r.type! };
			pendingFile = null;
		}
		text = '';
		const at = scheduleAt ? new Date(scheduleAt).getTime() : undefined;
		scheduleAt = '';
		showSchedule = false;
		const res = await fetch('/api/send', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ to: data.peer, text: body, image, file, at })
		});
		busy = false;
		if (res.ok) {
			mark_first_send();
			const body_r = await res.json();
			if (!body_r.scheduled)
				add_msg({ id: body_r.m.id, f: body_r.m.from, x: body_r.m.text, im: body_r.m.image, fl: body_r.m.file, d: body_r.m.ts });
		}
	}

	// `watch` is kept across reconnects; `check` re-runs on each connect via the same queue
	const watch = { type: 'watch', peer: data.peer };
	const check = { type: 'check', peer: data.peer };

	function connect() {
		unsub = ws_on((m) => {
			if (m.type === 'ws_down') {
				online = false;
				endCall();
			} else if (m.type === 'presence' && m.uid === data.peer) {
				online = m.online as boolean;
			}
			else if (m.type === 'msg' && m.from === data.peer) {
				add_msg({
				id: m.id as string,
				f: m.from as string,
				x: (m.text as string) ?? '',
				im: m.image as string | undefined,
				fl: m.file as FileAttach | undefined,
				d: m.ts as number
			});
			} else if (m.type === 'signal') handleSignal(m as never);
		});
		ws_send(watch, true);
		ws_send(check, true);
	}

	function createPC() {
		pc = new RTCPeerConnection({ iceServers: [stun] });
		pc.onicecandidate = (e) => {
			if (e.candidate)
				ws_send({ type: 'signal', to: data.peer, signal: { type: 'ice', candidate: e.candidate.toJSON() } });
		};
		pc.ontrack = (e) => { remoteStream = e.streams[0]; };
		if (localStream) for (const t of localStream.getTracks()) pc.addTrack(t, localStream);
	}

	function handleSignal(m: { from: string; signal: { type: string; sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit } }) {
		if (m.signal.type === 'ice' && pc) {
			pc.addIceCandidate(new RTCIceCandidate(m.signal.candidate));
		} else if (m.signal.type === 'offer') {
			pendingOffer = m.signal.sdp!;
			callState = 'ringing';
			if (!auto_tried && (auto === 'voice' || auto === 'video')) {
				auto_tried = true;
				videoOn = auto === 'video';
				answerCall();
			}
		} else if (m.signal.type === 'answer' && pc) {
			pc.setRemoteDescription(new RTCSessionDescription(m.signal.sdp!));
			callState = 'connected';
		}
	}

	// auto-start a call once both sides are connected, when we landed here via a random match.
	// Only the lexicographically-lower uid initiates — otherwise both sides would send an
	// offer at once (WebRTC glare); the other side auto-answers in handleSignal above.
	$effect(() => {
		if (
			!auto_tried &&
			(auto === 'voice' || auto === 'video') &&
			online &&
			callState === 'idle' &&
			me &&
			me < data.peer
		) {
			auto_tried = true;
			videoOn = auto === 'video';
			startCall();
		}
	});

	function findNew() {
		endCall();
		unsub?.();
		goto('/app/random');
	}

	async function startCall() {
		localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: videoOn });
		createPC();
		const offer = await pc!.createOffer();
		await pc!.setLocalDescription(offer);
		ws_send({ type: 'signal', to: data.peer, signal: { type: 'offer', sdp: offer } });
		callState = 'calling';
	}

	async function answerCall() {
		localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: videoOn });
		createPC();
		await pc!.setRemoteDescription(new RTCSessionDescription(pendingOffer!));
		const answer = await pc!.createAnswer();
		await pc!.setLocalDescription(answer);
		ws_send({ type: 'signal', to: data.peer, signal: { type: 'answer', sdp: answer } });
		callState = 'connected';
	}

	async function toggleVideo() {
		videoOn = !videoOn;
		if (localStream) {
			if (videoOn) {
				const s = await navigator.mediaDevices.getUserMedia({ video: true });
				for (const t of s.getVideoTracks()) localStream.addTrack(t);
			} else {
				for (const t of localStream.getVideoTracks()) { t.stop(); localStream.removeTrack(t); }
			}
			if (pc) for (const t of localStream.getTracks()) {
				const sender = pc.getSenders().find((s) => s.track?.kind === t.kind);
				if (sender) sender.replaceTrack(t);
			}
		}
	}

	function toggleMic() {
		micOn = !micOn;
		localStream?.getAudioTracks().forEach((t) => (t.enabled = micOn));
	}

	function endCall() {
		pc?.close();
		pc = null;
		localStream?.getTracks().forEach((t) => t.stop());
		localStream = null;
		remoteStream = null;
		callState = 'idle';
		pendingOffer = null;
	}

	let remoteVideo: HTMLVideoElement | undefined;
	let localVideo: HTMLVideoElement | undefined;

	$effect(() => {
		if (remoteVideo && remoteStream) remoteVideo.srcObject = remoteStream;
	});
	$effect(() => {
		if (localVideo && localStream) localVideo.srcObject = localStream;
	});

	onDestroy(() => {
		ws_drop(watch);
		ws_drop(check);
		ws_send({ type: 'unwatch', peer: data.peer });
		endCall();
		unsub?.();
	});

	onMount(() => connect());
</script>

<section class="chat mx-auto flex h-[calc(100dvh-150px)] max-w-[760px] flex-col sm:h-[calc(100dvh-110px)]">
	<header class="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line py-4">
		<button
			class="bg-none text-[22px] leading-none text-ink-soft transition-colors duration-300 hover:text-accent"
			onclick={() => goto('/app')}
			aria-label="back">←</button
		>
		<div class="flex min-w-0 flex-col gap-0.5">
			<a href="/app/user/{data.peer}" class="truncate font-display text-[21px] font-medium tracking-[-0.01em] transition-colors duration-300 hover:text-accent">{data.peer_name}</a>
			<div
				class="flex items-center gap-[7px] text-[10.5px] uppercase tracking-[0.2em] {online
					? 'text-accent'
					: 'text-faint'}"
			>
				<span
					class="h-1.5 w-1.5 rounded-full {online
						? 'bg-accent shadow-[0_0_0_3px var(--accent-soft)]'
						: 'bg-faint'}"
				></span>{online ? 'online' : 'offline'}
			</div>
		</div>
		<div class="ml-auto flex items-center gap-2">
			{#if callState === 'idle' && online}
				<button class="btn btn-ghost text-[13px]" onclick={startCall}>call</button>
			{/if}
			{#if callState === 'calling'}
				<span class="text-[12px] text-faint">calling…</span>
				<button class="btn btn-ghost text-[13px]" onclick={endCall}>cancel</button>
			{/if}
			{#if callState === 'ringing'}
				<span class="text-[12px] text-accent">incoming call</span>
				<button class="btn btn-amber text-[13px]" onclick={answerCall}>answer</button>
				<button class="btn btn-ghost text-[13px]" onclick={endCall}>decline</button>
			{/if}
			{#if callState === 'connected'}
				<button class="btn btn-ghost text-[13px]" onclick={toggleMic}>{micOn ? 'mic on' : 'muted'}</button>
				<button class="btn btn-ghost text-[13px]" onclick={toggleVideo}>{videoOn ? 'video on' : 'video off'}</button>
				<button class="btn btn-ghost text-[13px] text-red-500" onclick={endCall}>hang up</button>
			{/if}
			{#if auto}
				<button class="btn btn-ghost text-[13px]" onclick={findNew}>find someone new</button>
			{/if}
		</div>
	</header>
	{#if callState === 'connected'}
		<div class="relative mb-4 overflow-hidden rounded-lg border border-line bg-black">
			<video autoplay playsinline bind:this={remoteVideo}
				class="remote-video w-full max-h-[300px] object-contain"
			/>
			{#if localStream}
				<video autoplay playsinline muted bind:this={localVideo}
					class="absolute bottom-3 right-3 h-24 w-32 rounded-lg border border-line bg-black object-cover"
				/>
			{/if}
		</div>
	{/if}

	<div class="flex items-center gap-2 border-b border-line py-3">
		<input
			class="min-w-0 flex-1 px-3 py-1.5 text-[13px]"
			placeholder="search this thread…"
			bind:value={searchQ}
			onkeydown={(e) => e.key === 'Enter' && searchThread()}
		/>
		{#if searchResults !== null}
			<button class="btn text-[12px] py-1.5 px-3" onclick={() => { searchQ = ''; searchResults = null; }}>clear</button>
		{/if}
	</div>

	{#if searchResults !== null}
		<div class="flex flex-1 flex-col gap-2 overflow-y-auto py-4">
			{#if searching}
				<p class="text-[13px] text-faint">searching…</p>
			{:else if searchResults.length === 0}
				<p class="text-[13px] text-faint">no matches.</p>
			{:else}
				{#each searchResults as r (r.id)}
					<div class="rounded-[10px] border border-line bg-panel px-3 py-2 text-[14px] text-ink-soft">{r.x}</div>
				{/each}
			{/if}
		</div>
	{:else}
	<div class="thread flex flex-1 flex-col gap-3 overflow-y-auto py-7">
		{#each messages as m (m.id)}
			<div class="flex max-w-[85%] flex-col gap-1 sm:max-w-[70%] {m.f === me ? 'self-end items-end' : 'self-start'}">
				<div
					class="overflow-hidden px-4 py-3 text-[15px] leading-[1.5] {m.f ===
					me
						? 'rounded-[18px_4px_18px_18px] border border-accent bg-accent text-accent-ink'
						: 'rounded-[4px_18px_18px_18px] border border-line bg-panel-solid'}"
				>
					{#if m.im}
						<a href={media_src(m.im)} target="_blank" rel="noopener noreferrer">
							<img src={media_src(m.im)} alt="" class="mb-2 max-h-[320px] w-full rounded-[10px] object-cover" />
						</a>
					{/if}
					{#if m.fl}
						<a
							href={media_src(m.fl.key)}
							target="_blank"
							rel="noopener noreferrer"
							class="mb-2 flex items-center gap-2 rounded-[10px] border border-line bg-panel px-3 py-2 text-[13px] no-underline"
						>
							📎 <span class="truncate">{m.fl.name}</span>
							<span class="text-faint">{(m.fl.size / 1024).toFixed(0)}kb</span>
						</a>
					{/if}
					{#if m.x}{m.x}{/if}
				</div>
			</div>
		{/each}
	</div>
	{/if}

	{#if showSchedule}
		<div class="flex items-center gap-2 border-t border-line pt-4 text-[13px] text-ink-soft">
			<label for="schedule-at">send at</label>
			<input id="schedule-at" type="datetime-local" bind:value={scheduleAt} />
		</div>
	{/if}
	<form
		class="flex flex-wrap items-center gap-2 border-t border-line py-4"
		onsubmit={(e) => {
			e.preventDefault();
			send();
		}}
		ondragover={(e) => e.preventDefault()}
		ondrop={(e) => {
			const f = e.dataTransfer?.files?.[0];
			if (f) {
				e.preventDefault();
				pendingFile = f;
			}
		}}
	>
		<label
			class="btn shrink-0 cursor-pointer px-3 py-3 text-[15px]"
			aria-label="attach file"
			title={pendingFile ? pendingFile.name : 'attach file'}
		>
			{pendingFile ? '📎·1' : '📎'}
			<input
				type="file"
				class="hidden"
				onchange={(e) => {
					const f = (e.currentTarget as HTMLInputElement).files?.[0];
					if (f) pendingFile = f;
				}}
			/>
		</label>
		<input
			class="min-w-0 flex-1 text-[15px]"
			bind:value={text}
			placeholder="write something considered…"
			autocomplete="off"
			onpaste={(e) => {
				const f = image_from_event(e);
				if (f) pendingFile = f;
			}}
		/>
		<button
			type="button"
			class="btn shrink-0 px-3 py-3 text-[13px]"
			class:btn-amber={showSchedule || scheduleAt}
			aria-label="schedule send"
			title="schedule send"
			onclick={() => (showSchedule = !showSchedule)}
		>
			⏰
		</button>
		<button
			class="btn btn-amber shrink-0 !px-4"
			type="submit"
			disabled={busy}
			aria-label="send message"
			title="send"
		>
			{#if busy}
				<svg
					class="h-[18px] w-[18px] animate-spin"
					viewBox="0 0 24 24"
					fill="none"
					aria-hidden="true"
				>
					<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" />
					<path
						class="opacity-90"
						fill="currentColor"
						d="M12 2a10 10 0 0 1 10 10h-3a7 7 0 0 0-7-7z"
					/>
				</svg>
			{:else}
				<svg class="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" aria-hidden="true">
					<path
						d="M3.4 2.5 21 11.3a1 1 0 0 1 0 1.8L3.4 21.5a1 1 0 0 1-1.4-1.2L4.7 12 2 3.7a1 1 0 0 1 1.4-1.2Z"
						fill="currentColor"
					/>
				</svg>
			{/if}
		</button>
	</form>
</section>
