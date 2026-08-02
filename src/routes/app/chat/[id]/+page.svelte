<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { onMount, onDestroy, tick } from 'svelte';
	import { ws_on, ws_send, ws_drop } from '$lib/ws';
	import { confirm_sent, mark_failed } from '$lib/chat_optimistic';
	import { upload_file, media_src, image_from_event } from '$lib/attach';
	import { mark_first_send } from '$lib/notify-trigger';
	import { CallMesh, type CallSignal } from '$lib/call';
	import RemoteVideo from '$lib/components/RemoteVideo.svelte';
	import MuteButton from '$lib/components/MuteButton.svelte';
	import EmojiPicker from '$lib/components/EmojiPicker.svelte';
	import StickerPicker from '$lib/components/StickerPicker.svelte';
	import ForwardPicker from '$lib/components/ForwardPicker.svelte';
	import { sticker_src } from '$lib/stickers';
	import Modal from '$lib/components/Modal.svelte';
	import AiThread from '$lib/components/AiThread.svelte';
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
	type Msg = {
		id: string;
		f: string;
		x: string;
		im?: string;
		fl?: FileAttach;
		d: number;
		rp?: string;
		rx?: Record<string, string[]>;
		sk?: string;
		fw?: boolean;
		cid?: string;
		err?: boolean;
	};
	let { data } = $props();
	let muted = $state(data.muted as boolean);
	let messages = $state(data.messages as Msg[]);
	let threadEl: HTMLDivElement | undefined = $state();
	const AT_BOTTOM_SLACK = 80;
	function isAtBottom(): boolean {
		if (!threadEl) return true;
		return threadEl.scrollHeight - threadEl.scrollTop - threadEl.clientHeight < AT_BOTTOM_SLACK;
	}
	function add_msg(m: Msg) {
		if (m.id && messages.some((e) => e.id === m.id)) return;
		const wasAtBottom = isAtBottom();
		messages = [...messages, m];
		if (wasAtBottom) tick().then(() => threadEl?.scrollTo({ top: threadEl.scrollHeight }));
	}
	let loading_older = $state(false);
	let no_more = $state(false);

	let replyTo = $state<Msg | null>(null);

	function startReply(m: Msg) {
		replyTo = m;
	}

	function cancelReply() {
		replyTo = null;
	}

	let quoted = $state<Record<string, Msg | null>>({});
	async function resolveQuote(id: string) {
		if (id in quoted) return;
		const local = messages.find((e) => e.id === id);
		if (local) {
			quoted[id] = local;
			return;
		}
		const res = await fetch(`/api/messages/${id}`).catch(() => null);
		quoted[id] = res?.ok ? (await res.json()).m : null;
	}
	$effect(() => {
		for (const m of messages) if (m.rp && !(m.rp in quoted)) resolveQuote(m.rp);
	});

	let reactingTo = $state<string | null>(null);
	let reactionListFor = $state<string | null>(null);

	async function react(id: string, emoji: string) {
		reactingTo = null;
		const res = await fetch(`/api/messages/${id}/react`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ emoji })
		}).catch(() => null);
		if (res?.ok) {
			const { rx } = await res.json();
			messages = messages.map((e) => (e.id === id ? { ...e, rx } : e));
		}
	}

	let stickerOpen = $state(false);

	async function sendSticker(id: string) {
		stickerOpen = false;
		const row: Msg = { id: '', cid: crypto.randomUUID(), f: me!, x: '', sk: id, d: Date.now() };
		add_msg(row);
		const res = await fetch('/api/send', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ to: data.peer, sticker: id })
		}).catch(() => null);
		if (!res?.ok) {
			messages = mark_failed(messages, row.cid!);
			return;
		}
		mark_first_send();
		const { m } = await res.json();
		if (m) messages = confirm_sent(messages, row.cid!, { id: m.id, d: m.ts });
	}

	let forwarding = $state<Msg | null>(null);
	let forwardData = $state<{ conversations: { peer: string }[]; rooms: { id: string; name: string }[] } | null>(null);
	async function openForward(m: Msg) {
		forwarding = m;
		if (forwardData) return;
		forwardData = await Promise.all([
			fetch('/api/conversations').then((r) => r.json()),
			fetch('/api/groups?mine=1').then((r) => r.json())
		]).then(([c, g]) => ({ conversations: ((c as { r?: { peer: string }[] })?.r ?? []), rooms: ((g as { r?: { id: string; name: string }[] })?.r ?? []) }));
	}
	async function doForward(targets: { to?: string; group?: string }[]) {
		if (!forwarding) return;
		const body = forwarding.sk ? { sticker: forwarding.sk } : { text: forwarding.x };
		await Promise.all(
			targets.map((t) =>
				fetch('/api/send', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ ...body, forwarded: true, ...t })
				})
			)
		);
		forwarding = null;
	}

	async function load_older() {
		if (loading_older || no_more || !messages.length) return;
		loading_older = true;
		const before = messages[0].d;
		const res = await fetch(
			`/api/messages?u=${encodeURIComponent(data.peer)}&before=${before}`
		).catch(() => null);
		if (res?.ok) {
			const older = (await res.json()).r as Msg[];
			if (!older.length) no_more = true;
			else messages = [...older, ...messages];
		}
		loading_older = false;
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
		const res = await fetch(
			`/api/search/messages?q=${encodeURIComponent(q)}&conv=${encodeURIComponent(data.peer)}`
		);
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
			send: (to, signal) => ws_send({ type: 'signal', to, signal, ctx: 'dm' }),
			onremote: (uid, stream) => {
				if (uid !== data.peer) return;
				if (!stream) {
					mesh?.hangup(true);
					return resetCall();
				}
				remoteStream = stream;
				callState = 'connected';
			},
			onincoming: () => (callState = 'ringing'),
			fetchTurn: async () => {
				const r = await fetch('/api/turn', { method: 'POST' }).catch(() => null);
				if (!r?.ok) return [];
				const { iceServers } = await r.json() as { iceServers: RTCIceServer[] };
				return iceServers;
			}
		});
	}

	async function send(retry?: Msg) {
		const body = retry ? retry.x : text.trim();
		if ((!body && !pendingFile && !retry) || busy) return;

		let image: string | undefined;
		let file: FileAttach | undefined;
		if (!retry && pendingFile) {
			busy = true;
			const r = await upload_file(pendingFile);
			busy = false;
			if (r.error || !r.key) return;
			if (pendingFile.type.startsWith('image/')) image = r.key;
			else file = { key: r.key, name: r.name!, size: r.size!, type: r.type! };
			pendingFile = null;
		}

		const at = retry ? undefined : scheduleAt ? new Date(scheduleAt).getTime() : undefined;
		if (!retry) {
			text = '';
			scheduleAt = '';
			showSchedule = false;
		}

		let row: Msg | undefined;
		if (!at) {
			if (retry) {
				retry.err = false;
				row = retry;
			} else {
				row = { id: '', cid: crypto.randomUUID(), f: me!, x: body, im: image, fl: file, d: Date.now() };
				add_msg(row);
			}
		}

		const res = await fetch('/api/send', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ to: data.peer, text: body, image, file, at, reply_to: replyTo?.id })
		}).catch(() => null);

		if (!res?.ok) {
			if (row?.cid) messages = mark_failed(messages, row.cid);
			return;
		}
		mark_first_send();
		replyTo = null;
		const { m } = await res.json();
		if (row?.cid && m) messages = confirm_sent(messages, row.cid, { id: m.id, d: m.ts });
	}

	const watch = { type: 'watch', peer: data.peer };
	const check = { type: 'check', peer: data.peer };

	function connect() {
		unsub = ws_on((m) => {
			if (m.type === 'ws_down') {
				online = false;
				endCall(true);
			} else if (m.type === 'presence' && m.uid === data.peer) {
				online = m.online as boolean;
			} else if (m.type === 'reaction') {
				messages = messages.map((e) =>
					e.id === m.id ? { ...e, rx: m.rx as Record<string, string[]> } : e
				);
			} else if (m.type === 'edit') {
				messages = messages.map((e) =>
					e.id === m.id ? { ...e, x: m.text as string, e: m.ts as number } : e
				);
			} else if (m.type === 'delete') {
				messages = messages.filter((e) => e.id !== m.id);
			} else if (m.type === 'msg' && m.from === data.peer) {
				add_msg({
					id: m.id as string,
					f: m.from as string,
					x: (m.text as string) ?? '',
					im: m.image as string | undefined,
					fl: m.file as FileAttach | undefined,
					rp: m.reply_msg as string | undefined,
					sk: m.sticker as string | undefined,
					fw: m.fw as boolean | undefined,
					d: m.ts as number
				});
			} else if (m.type === 'signal' && m.from === data.peer && m.ctx === 'dm') {
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

	onMount(async () => {
		const replyId = $page.url.searchParams.get('reply');
		if (replyId) {
			const local = messages.find((e) => e.id === replyId);
			if (local) replyTo = local;
			else {
				const res = await fetch(`/api/messages/${replyId}`).catch(() => null);
				if (res?.ok) replyTo = (await res.json()).m;
			}
		}
		connect();
	});
</script>

<section class="chat mx-auto flex h-[calc(100dvh-var(--chrome))] max-w-[760px] flex-col">
	<header class="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line py-4">
		<button
			class="bg-none leading-none text-ink-soft transition-colors duration-300 hover:text-accent"
			onclick={() => goto('/app')}
			aria-label="back"
		>
			<ArrowLeft size={22} />
		</button>
		<div class="flex min-w-0 flex-col gap-0.5">
			<a
				href="/app/user/{data.peer}"
				class="truncate font-display text-[21px] font-medium tracking-[-0.01em] transition-colors duration-300 hover:text-accent"
				>{data.peer_name}</a
			>
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
			<AiThread conv={data.conv} peerName={data.peer_name} />
			<MuteButton target={data.peer} kind="u" bind:muted label="notifications from this person" />
			{#if callState === 'idle' && online}
				<button class="btn btn-ghost flex items-center gap-1.5 text-[13px]" onclick={startCall}>
					<Phone size={15} /> call
				</button>
			{/if}
			{#if callState === 'calling'}
				<span class="text-[12px] text-faint">calling…</span>
				<button
					class="btn btn-ghost flex items-center gap-1.5 text-[13px]"
					onclick={() => endCall()}
				>
					<PhoneOff size={15} /> cancel
				</button>
			{/if}
			{#if callState === 'ringing'}
				<span class="text-[12px] text-accent">incoming call</span>
				<button class="btn btn-amber flex items-center gap-1.5 text-[13px]" onclick={answerCall}>
					<Phone size={15} /> answer
				</button>
				<button
					class="btn btn-ghost flex items-center gap-1.5 text-[13px]"
					onclick={() => endCall()}
				>
					<PhoneOff size={15} /> decline
				</button>
			{/if}
			{#if callState === 'connected'}
				<button class="btn btn-ghost flex items-center gap-1.5 text-[13px]" onclick={toggleMic}>
					{#if micOn}<Mic size={15} />{:else}<MicOff size={15} />{/if}
					{micOn ? 'mic on' : 'muted'}
				</button>
				<button class="btn btn-ghost flex items-center gap-1.5 text-[13px]" onclick={toggleVideo}>
					{#if videoOn}<Video size={15} />{:else}<VideoOff size={15} />{/if}
					{videoOn ? 'video on' : 'video off'}
				</button>
				<button
					class="btn btn-ghost flex items-center gap-1.5 text-[13px] text-red-500"
					onclick={() => endCall()}
				>
					<PhoneOff size={15} /> hang up
				</button>
			{/if}
		</div>
	</header>
	{#if callError}
		<p class="border-b border-line py-2 text-[12.5px] text-[#e2674c]">{callError}</p>
	{/if}
	{#if callState === 'connected'}
		<div
			class="reveal relative mb-4 overflow-hidden rounded-[16px] border border-accent/40 bg-black shadow-[0_0_0_1px_rgba(217,139,95,0.08),0_20px_50px_-20px_rgba(0,0,0,0.6)]"
		>
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
			<Search
				size={14}
				class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint"
			/>
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
				onclick={() => {
					searchQ = '';
					searchResults = null;
				}}
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
					<div
						class="rounded-[10px] border border-line bg-panel px-3 py-2 text-[14px] text-ink-soft"
					>
						{r.x}
					</div>
				{/each}
			{/if}
		</div>
	{:else}
		<div class="thread flex flex-1 flex-col gap-3 overflow-y-auto py-7" bind:this={threadEl}>
			{#if !no_more && messages.length}
				<button
					class="btn btn-ghost mx-auto text-[12px]"
					onclick={load_older}
					disabled={loading_older}
				>
					{loading_older ? 'loading…' : 'load older messages'}
				</button>
			{/if}
			{#each messages as m (m.cid ?? m.id)}
				<div
					class="group flex max-w-[85%] flex-col gap-1 sm:max-w-[70%] {m.f === me
						? 'self-end items-end'
						: 'self-start'}"
				>
				<div
					class="overflow-hidden px-4 py-3 text-[15px] leading-[1.5] {m.f === me
						? 'rounded-[18px_4px_18px_18px] border border-accent bg-accent text-accent-ink'
						: 'rounded-[4px_18px_18px_18px] border border-line bg-panel-solid'}"
					class:border-0={m.sk}
					class:bg-transparent={m.sk}
					class:p-0={m.sk}
				class:opacity-60={m.id === '' && !m.err}
			>
				{#if m.fw}
					<div class="mb-1 text-[10.5px] uppercase tracking-[0.12em] text-faint">forwarded</div>
				{/if}
				{#if m.sk}
					<img
						src={sticker_src(m.sk)}
						alt={m.sk + ' sticker'}
						class="h-[120px] w-[120px] object-contain"
					/>
				{:else}
					{#if m.rp}
							<div class="mb-2 truncate border-l-2 border-accent/50 pl-2 text-[12.5px] opacity-70">
								{quoted[m.rp]?.x || 'original message'}
							</div>
						{/if}
						{#if m.im}
							<a href={media_src(m.im)} target="_blank" rel="noopener noreferrer">
								<img
									src={media_src(m.im)}
									alt=""
									class="mb-2 max-h-[320px] w-full rounded-[10px] object-cover"
								/>
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
						{#if m.rx && Object.keys(m.rx).length}
							<div class="mt-1 flex flex-wrap gap-1">
								{#each Object.entries(m.rx).slice(0, 3) as [emoji, uids] (emoji)}
									<button
										type="button"
										class="flex items-center gap-1 rounded-full border border-line bg-panel px-2 py-0.5 text-[12px]"
										class:border-accent={uids.includes(me)}
										onclick={() => react(m.id, emoji)}
									>
										{emoji} {uids.length}
									</button>
								{/each}
							{#if Object.keys(m.rx).length > 3}
								<button
									type="button"
									class="rounded-full border border-line bg-panel px-2 py-0.5 text-[12px] text-mute"
									onclick={() => (reactionListFor = m.id)}
									>+{Object.keys(m.rx).length - 3}</button
								>
							{/if}
						</div>
					{/if}
					{/if}
				</div>
					{#if m.err}
						<button class="self-end text-[11px] text-[#e2674c] underline" onclick={() => send(m)}>
							not sent — retry
						</button>
					{/if}
					<div
						class="flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
					>
						<button
							type="button"
							class="text-[11px] text-faint hover:text-accent"
							onclick={() => startReply(m)}
							>reply</button
						>
						<button
							type="button"
							class="text-[11px] text-faint hover:text-accent"
							onclick={() => (reactingTo = m.id)}
							>react</button
						>
						<button
							type="button"
							class="text-[11px] text-faint hover:text-accent"
							onclick={() => openForward(m)}
							>forward</button
						>
					</div>
				</div>
			{/each}
		</div>
	{/if}

	{#if replyTo}
		<div class="flex items-center gap-2 border-t border-line px-1 py-2 text-[12.5px] text-ink-soft">
			<div class="min-w-0 flex-1 truncate border-l-2 border-accent pl-2">{replyTo.x || '(attachment)'}</div>
			<button
				type="button"
				class="text-faint hover:text-accent"
				onclick={cancelReply}
				aria-label="cancel reply"
				>&times;</button
			>
		</div>
	{/if}

	{#if reactingTo}
		<Modal open onclose={() => (reactingTo = null)} title="react">
			<EmojiPicker
				onselect={(e) => react(reactingTo!, e)}
				onclose={() => (reactingTo = null)}
			/>
		</Modal>
	{/if}
	{#if reactionListFor}
		<Modal open onclose={() => (reactionListFor = null)} title="reactions">
			<div class="flex flex-col gap-2">
				{#each Object.entries(messages.find((e) => e.id === reactionListFor)?.rx ?? {}) as [emoji, uids] (emoji)}
					<div class="flex items-center gap-2 text-[14px]">
						<span>{emoji}</span>
						<span>{uids.map((u) => (u === me ? 'you' : data.peer_name)).join(', ')}</span>
					</div>
				{/each}
			</div>
		</Modal>
	{/if}

	{#if stickerOpen}
		<Modal open onclose={() => (stickerOpen = false)} title="sticker">
			<StickerPicker
				onselect={(e) => sendSticker(e)}
				onclose={() => (stickerOpen = false)}
			/>
		</Modal>
	{/if}

	{#if forwarding}
		<Modal open onclose={() => (forwarding = null)} title="forward to…">
			{#if forwardData}
				<ForwardPicker
					data={forwardData}
					onforward={(targets) => doForward(targets)}
					onclose={() => (forwarding = null)}
				/>
			{:else}
				<p class="text-[13px] text-faint">loading…</p>
			{/if}
		</Modal>
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
		<button
			type="button"
			class="btn shrink-0 px-3 py-3"
			aria-label="sticker"
			title="send a sticker"
			onclick={() => (stickerOpen = true)}
		>
			<span class="text-[15px] leading-none">🙂</span>
		</button>
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
			<SendIcon size={18} />
		</button>
	</form>
</section>
