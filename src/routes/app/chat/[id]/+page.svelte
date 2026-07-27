<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { onMount, onDestroy } from 'svelte';

	let { data } = $props();
	let messages = $state(data.messages as { f: string; x: string; d: number }[]);
	let text = $state('');
	let ws: WebSocket | null = $state(null);
	let online = $state(false);
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
		if (!body) return;
		text = '';
		const res = await fetch('/api/send', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ to: data.peer, text: body })
		});
		if (res.ok) {
			const { m } = await res.json();
			messages = [...messages, { f: m.from, x: m.text, d: m.ts }];
		}
	}

	function connect() {
		fetch('/api/wstoken')
			.then((r) => r.json())
			.then((j) => {
				ws = new WebSocket(j.ws);
				ws.onopen = () => {
					ws!.send(JSON.stringify({ type: 'watch', peer: data.peer }));
					ws!.send(JSON.stringify({ type: 'check', peer: data.peer }));
				};
				ws.onmessage = (ev) => {
					const m = JSON.parse(ev.data);
					if (m.type === 'presence' && m.uid === data.peer) online = m.online;
					else if (m.type === 'msg' && m.from === data.peer)
						messages = [...messages, { f: m.from, x: m.text, d: m.ts }];
					else if (m.type === 'signal') handleSignal(m);
				};
				ws.onclose = () => {
					online = false;
					endCall();
				};
			});
	}

	function createPC() {
		pc = new RTCPeerConnection({ iceServers: [stun] });
		pc.onicecandidate = (e) => {
			if (e.candidate && ws?.readyState === WebSocket.OPEN)
				ws.send(JSON.stringify({ type: 'signal', to: data.peer, signal: { type: 'ice', candidate: e.candidate.toJSON() } }));
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
		ws?.close();
		goto('/app/random');
	}

	async function startCall() {
		localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: videoOn });
		createPC();
		const offer = await pc!.createOffer();
		await pc!.setLocalDescription(offer);
		ws!.send(JSON.stringify({ type: 'signal', to: data.peer, signal: { type: 'offer', sdp: offer } }));
		callState = 'calling';
	}

	async function answerCall() {
		localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: videoOn });
		createPC();
		await pc!.setRemoteDescription(new RTCSessionDescription(pendingOffer!));
		const answer = await pc!.createAnswer();
		await pc!.setLocalDescription(answer);
		ws!.send(JSON.stringify({ type: 'signal', to: data.peer, signal: { type: 'answer', sdp: answer } }));
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
		if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'unwatch', peer: data.peer }));
		endCall();
		ws?.close();
	});

	onMount(() => connect());
</script>

<section class="chat mx-auto flex h-[calc(100dvh-90px)] max-w-[760px] flex-col">
	<header class="flex items-center gap-4 border-b border-line py-4">
		<button
			class="bg-none text-[22px] leading-none text-ink-soft transition-colors duration-300 hover:text-accent"
			onclick={() => goto('/app')}
			aria-label="back">←</button
		>
		<div class="flex flex-col gap-0.5">
			<div class="font-display text-[21px] font-medium tracking-[-0.01em]">{data.peer_name}</div>
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

	<div class="thread flex flex-1 flex-col gap-3 overflow-y-auto py-7">
		{#each messages as m (m.d + m.x)}
			<div
				class="max-w-[70%] rounded-[4px_18px_18px_18px] border border-line bg-panel-solid px-4 py-3 text-[15px] leading-[1.5] {m.f ===
				me
					? 'self-end rounded-[18px_4px_18px_18px] border-accent bg-accent text-accent-ink'
					: 'self-start'}"
			>
				{m.x}
			</div>
		{/each}
	</div>

	<form
		class="flex gap-3 border-t border-line py-4"
		onsubmit={(e) => {
			e.preventDefault();
			send();
		}}
	>
		<input class="text-[15px]" bind:value={text} placeholder="write something considered…" autocomplete="off" />
		<button class="btn btn-amber" type="submit">drop into thread</button>
	</form>
</section>
