<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { onMount, onDestroy, tick } from 'svelte';
	import { ws_on, ws_send, ws_drop } from '$lib/ws';
	import { upload_file, media_src, image_from_event } from '$lib/attach';
	import { mark_first_send } from '$lib/notify-trigger';
	import { CallMesh, type CallSignal } from '$lib/call';
	import RemoteVideo from '$lib/components/RemoteVideo.svelte';
	import {
		ArrowLeft,
		Phone,
		PhoneOff,
		Video,
		VideoOff,
		Mic,
		MicOff,
		Paperclip,
		Clock,
		Search,
		Send as SendIcon,
		LoaderCircle,
		FileText,
		X
	} from '@lucide/svelte';

	type FileAttach = { key: string; name: string; size: number; type: string };
	let { data } = $props();
	let messages = $state(
		data.messages as { id: string; f: string; x: string; im?: string; fl?: FileAttach; d: number }[]
	);
	let threadEl: HTMLDivElement | undefined = $state();
	const AT_BOTTOM_SLACK = 80; // px of slop still counted as "at the bottom"
	function isAtBottom(): boolean {
		if (!threadEl) return true;
		return threadEl.scrollHeight - threadEl.scrollTop - threadEl.clientHeight < AT_BOTTOM_SLACK;
	}
	function add_msg(m: { id: string; f: string; x: string; im?: string; fl?: FileAttach; d: number }) {
		if (messages.some((e) => e.id === m.id)) return;
		const wasAtBottom = isAtBottom();
		messages = [...messages, m];
		if (wasAtBottom) tick().then(() => threadEl?.scrollTo({ top: threadEl.scrollHeight }));
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

	let mesh: CallMesh | null = null;
	let localStream = $state<MediaStream | null>(null);
	let remoteStream = $state<MediaStream | null>(null);
	let callState = $state<'idle' | 'calling' | 'ringing' | 'connected'>('idle');
	let videoOn = $state(false);
	let micOn = $state(true);
	let callError = $state('');

	function resetCall() {
		mesh = null;
		localStream = null;
		remoteStream = null;
		callState = 'idle';
		micOn = true;
	}

	function makeMesh(): CallMesh {
		return new CallMesh({
			me: me!,
			// `ctx` scopes this signal to the DM call — without it, a room call's `join`
			// broadcast (sent to every room member, including this peer) would be handled
			// here too and could renegotiate this connection out from under itself
			send: (to, signal) => ws_send({ type: 'signal', to, signal, ctx: 'dm' }),
			onremote: (uid, stream) => {
				if (uid !== data.peer) return;
				if (!stream) {
					// peer hung up or dropped — mesh already removed them internally;
					// hangup(true) just releases our own mic/camera, no bye to send
					mesh?.hangup(true);
					return resetCall();
				}
				remoteStream = stream;
				callState = 'connected';
			},
			onincoming: () => (callState = 'ringing')
		});
	}

	async function send() {
		const body = text.trim();
		console.log('[CHAT-CLIENT] send() called', { peer: data.peer, bodyLen: body.length, hasPendingFile: !!pendingFile });
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
		console.log('[CHAT-CLIENT] POSTing /api/send', { to: data.peer, textLen: body.length, hasImage: !!image, hasFile: !!file, at });
		const res = await fetch('/api/send', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ to: data.peer, text: body, image, file, at })
		});
		console.log('[CHAT-CLIENT] /api/send responded', { status: res.status, ok: res.ok });
		busy = false;
		if (res.ok) {
			mark_first_send();
			const body_r = await res.json();
			console.log('[CHAT-CLIENT] /api/send body', body_r);
			if (!body_r.scheduled)
				add_msg({ id: body_r.m.id, f: body_r.m.from, x: body_r.m.text, im: body_r.m.image, fl: body_r.m.file, d: body_r.m.ts });
		} else {
			console.error('[CHAT-CLIENT] /api/send FAILED', await res.text().catch(() => '<unreadable>'));
		}
	}

	// `watch` is kept across reconnects; `check` re-runs on each connect via the same queue
	const watch = { type: 'watch', peer: data.peer };
	const check = { type: 'check', peer: data.peer };

	function connect() {
		console.log('[CHAT-CLIENT] connect() — subscribing to ws_on for peer=', data.peer);
		unsub = ws_on((m) => {
			console.log('[CHAT-CLIENT] ws message received in chat page', m);
			if (m.type === 'ws_down') {
				console.warn('[CHAT-CLIENT] ws_down — marking peer offline');
				online = false;
				endCall(true); // socket is gone; a bye would never arrive
			} else if (m.type === 'presence' && m.uid === data.peer) {
				console.log('[CHAT-CLIENT] presence update for peer', m.online);
				online = m.online as boolean;
			}
			else if (m.type === 'msg' && m.from === data.peer) {
				console.log('[CHAT-CLIENT] incoming msg from current peer, appending to thread', m);
				add_msg({
				id: m.id as string,
				f: m.from as string,
				x: (m.text as string) ?? '',
				im: m.image as string | undefined,
				fl: m.file as FileAttach | undefined,
				d: m.ts as number
			});
			} else if (m.type === 'msg') {
				console.log('[CHAT-CLIENT] incoming msg but NOT from current peer, ignoring here', { from: m.from, expectedPeer: data.peer });
			} else if (m.type === 'signal' && m.from === data.peer && m.ctx === 'dm') {
				// lazily create the mesh so an inbound offer can ring before we've called
				mesh ??= makeMesh();
				mesh.handle(m.from as string, m.signal as CallSignal);
			}
		});
		ws_send(watch, true);
		ws_send(check, true);
	}

	async function startCall() {
		callError = '';
		mesh = makeMesh();
		try {
			localStream = await mesh.open(videoOn);
			await mesh.invite(data.peer);
			callState = 'calling';
		} catch (e) {
			console.error('[CHAT-CLIENT] startCall failed', e);
			callError = 'could not access camera/mic — check permissions.';
			mesh = null;
			callState = 'idle';
		}
	}

	async function answerCall() {
		if (!mesh) return;
		callError = '';
		try {
			localStream = await mesh.open(videoOn);
			await mesh.accept(data.peer);
			callState = 'connected';
		} catch (e) {
			console.error('[CHAT-CLIENT] answerCall failed', e);
			callError = 'could not access camera/mic — check permissions.';
			mesh = null;
			callState = 'idle';
		}
	}

	async function toggleVideo() {
		videoOn = !videoOn;
		await mesh?.setVideo(videoOn);
	}

	function toggleMic() {
		micOn = !micOn;
		mesh?.setMic(micOn);
	}

	/** hangs up locally AND tells the peer, so their UI leaves the call too */
	function endCall(silent = false) {
		mesh?.hangup(silent);
		resetCall();
	}

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
			class="bg-none leading-none text-ink-soft transition-colors duration-300 hover:text-accent"
			onclick={() => goto('/app')}
			aria-label="back"
		>
			<ArrowLeft size={22} />
		</button>
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
				<button class="btn btn-ghost flex items-center gap-1.5 text-[13px]" onclick={startCall}>
					<Phone size={15} /> call
				</button>
			{/if}
			{#if callState === 'calling'}
				<span class="text-[12px] text-faint">calling…</span>
				<button class="btn btn-ghost flex items-center gap-1.5 text-[13px]" onclick={() => endCall()}>
					<PhoneOff size={15} /> cancel
				</button>
			{/if}
			{#if callState === 'ringing'}
				<span class="text-[12px] text-accent">incoming call</span>
				<button class="btn btn-amber flex items-center gap-1.5 text-[13px]" onclick={answerCall}>
					<Phone size={15} /> answer
				</button>
				<button class="btn btn-ghost flex items-center gap-1.5 text-[13px]" onclick={() => endCall()}>
					<PhoneOff size={15} /> decline
				</button>
			{/if}
			{#if callState === 'connected'}
				<button class="btn btn-ghost flex items-center gap-1.5 text-[13px]" onclick={toggleMic}>
					{#if micOn}<Mic size={15} />{:else}<MicOff size={15} />{/if} {micOn ? 'mic on' : 'muted'}
				</button>
				<button class="btn btn-ghost flex items-center gap-1.5 text-[13px]" onclick={toggleVideo}>
					{#if videoOn}<Video size={15} />{:else}<VideoOff size={15} />{/if} {videoOn ? 'video on' : 'video off'}
				</button>
				<button class="btn btn-ghost flex items-center gap-1.5 text-[13px] text-red-500" onclick={() => endCall()}>
					<PhoneOff size={15} /> hang up
				</button>
			{/if}
		</div>
	</header>
	{#if callError}
		<p class="border-b border-line py-2 text-[12.5px] text-[#e2674c]">{callError}</p>
	{/if}
	{#if callState === 'connected'}
		<div class="reveal relative mb-4 overflow-hidden rounded-[16px] border border-accent/40 bg-black shadow-[0_0_0_1px_rgba(217,139,95,0.08),0_20px_50px_-20px_rgba(0,0,0,0.6)]">
			<RemoteVideo stream={remoteStream} class="w-full max-h-[300px] object-contain" />
			{#if localStream}
				<RemoteVideo
					stream={localStream}
					muted
					class="absolute bottom-3 right-3 h-24 w-32 rounded-[10px] border border-line-2 bg-black object-cover shadow-lg"
				/>
			{/if}
		</div>
	{/if}

	<div class="flex items-center gap-2 border-b border-line py-3">
		<div class="relative min-w-0 flex-1">
			<Search size={14} class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint" />
			<input
				class="min-w-0 w-full py-1.5 pr-3 pl-8 text-[13px]"
				placeholder="search this thread…"
				bind:value={searchQ}
				onkeydown={(e) => e.key === 'Enter' && searchThread()}
			/>
		</div>
		{#if searchResults !== null}
			<button
				class="btn flex items-center gap-1 py-1.5 px-3 text-[12px]"
				onclick={() => { searchQ = ''; searchResults = null; }}
			>
				<X size={13} /> clear
			</button>
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
	<div class="thread flex flex-1 flex-col gap-3 overflow-y-auto py-7" bind:this={threadEl}>
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
							<FileText size={15} class="shrink-0" />
							<span class="truncate">{m.fl.name}</span>
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
			class="btn shrink-0 cursor-pointer px-3 py-3"
			aria-label="attach file"
			title={pendingFile ? pendingFile.name : 'attach file'}
		>
			<span class="flex items-center gap-1">
				<Paperclip size={16} />{#if pendingFile}<span class="text-[11px]">1</span>{/if}
			</span>
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
			class="btn shrink-0 px-3 py-3"
			class:btn-amber={showSchedule || scheduleAt}
			aria-label="schedule send"
			title="schedule send"
			onclick={() => (showSchedule = !showSchedule)}
		>
			<Clock size={16} />
		</button>
		<button
			class="btn btn-amber shrink-0 !px-4"
			type="submit"
			disabled={busy}
			aria-label="send message"
			title="send"
		>
			{#if busy}
				<LoaderCircle size={18} class="animate-spin" />
			{:else}
				<SendIcon size={18} />
			{/if}
		</button>
	</form>
</section>
