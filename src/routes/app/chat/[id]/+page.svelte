<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { onMount, onDestroy, tick } from 'svelte';
	import { ws_on, ws_send, ws_drop } from '$lib/ws';
	import { confirm_sent, mark_failed } from '$lib/chat_optimistic';
	import { upload_file, media_src, image_from_event } from '$lib/attach';
	import { mark_first_send } from '$lib/notify-trigger';
	import { sync_badge } from '$lib/badge';
	import { ctrlEnter } from '$lib/actions';
	import { CallMesh, media_error, VIDEO_FALLBACK, type CallSignal } from '$lib/call';
	import CallOverlay from '$lib/components/CallOverlay.svelte';
	import MuteButton from '$lib/components/MuteButton.svelte';
	import EmojiPicker from '$lib/components/EmojiPicker.svelte';
	import StickerPicker from '$lib/components/StickerPicker.svelte';
	import ForwardPicker from '$lib/components/ForwardPicker.svelte';
	import { sticker_src } from '$lib/stickers';
	import { day_label, clock } from '$lib/time';
	import Modal from '$lib/components/Modal.svelte';
	import AiThread from '$lib/components/AiThread.svelte';
	import {
		ArrowLeft,
		Phone,
		Video,
		Paperclip,
		Clock,
		Send as SendIcon,
		FileText,
		Sticker,
		CornerUpLeft,
		SmilePlus,
		Forward,
		Smile
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
	function toBottom(smooth = false) {
		threadEl?.scrollTo({ top: threadEl.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
	}
	function add_msg(m: Msg) {
		if (m.id && messages.some((e) => e.id === m.id)) return;
		const wasAtBottom = isAtBottom();
		messages = [...messages, m];
		if (wasAtBottom) tick().then(() => toBottom());
	}
	let loading_older = $state(false);
	let no_more = $state(false);

	let replyTo = $state<Msg | null>(null);

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

	let emojiOpen = $state(false);
	let composerInput: HTMLTextAreaElement | undefined = $state();
	let emojiCursor = $state(0);

	function openEmoji() {
		emojiCursor = composerInput?.selectionStart ?? text.length;
		emojiOpen = true;
	}

	function insertEmoji(e: string) {
		emojiOpen = false;
		text = text.slice(0, emojiCursor) + e + text.slice(emojiCursor);
		emojiCursor += e.length;
		tick().then(() => {
			composerInput?.focus();
			composerInput?.setSelectionRange(emojiCursor, emojiCursor);
		});
	}

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
	let forwardData = $state<{
		conversations: { peer: string }[];
		rooms: { id: string; name: string }[];
	} | null>(null);
	async function openForward(m: Msg) {
		forwarding = m;
		if (forwardData) return;
		forwardData = await Promise.all([
			fetch('/api/conversations').then((r) => r.json()),
			fetch('/api/groups?mine=1').then((r) => r.json())
		]).then(([c, g]) => ({
			conversations: (c as { r?: { peer: string }[] })?.r ?? [],
			rooms: (g as { r?: { id: string; name: string }[] })?.r ?? []
		}));
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
	let peers = $derived([{ uid: data.peer, name: data.peer_name, stream: remoteStream }]);

	function resetCall() {
		mesh = null;
		localStream = null;
		remoteStream = null;
		callState = 'idle';
		micOn = true;
		videoOn = false;
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
				const { iceServers } = (await r.json()) as {
					iceServers: RTCIceServer | RTCIceServer[];
				};
				return Array.isArray(iceServers) ? iceServers : [iceServers];
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
			if (composerInput) composerInput.style.height = 'auto';
		}

		let row: Msg | undefined;
		if (!at) {
			if (retry) {
				retry.err = false;
				row = retry;
			} else {
				row = {
					id: '',
					cid: crypto.randomUUID(),
					f: me!,
					x: body,
					im: image,
					fl: file,
					d: Date.now(),
					rp: replyTo?.id
				};
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
		if (row?.cid && m)
			messages = confirm_sent(messages, row.cid, {
				id: m.id,
				d: m.ts,
				rp: m.rp,
				sk: m.sk,
				fw: m.fw
			});
	}

	const watch = { type: 'watch', peer: data.peer };
	const check = { type: 'check', peer: data.peer };

	async function mark_read() {
		try {
			await fetch('/api/read', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ conv: data.conv, ts: Date.now() })
			});
			await sync_badge();
		} catch {
			/* the badge is cosmetic — never let it break the thread */
		}
	}

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
				// the thread is open, so nothing here is unread — keep the badge honest
				mark_read();
			} else if (m.type === 'signal' && m.from === data.peer && m.ctx === 'dm') {
				mesh ??= makeMesh();
				mesh.handle(m.from as string, m.signal as CallSignal);
			}
		});
		ws_send(watch, true);
		ws_send(check, true);
	}

	async function startCall(withVideo = false) {
		callError = '';
		if (!online) {
			// a call to someone with no socket open rings nowhere and sits on "calling…" forever
			callError = `${data.peer_name} is offline — send a message instead.`;
			return;
		}
		videoOn = withVideo;
		mesh = makeMesh();
		try {
			localStream = await mesh.open(videoOn);
		} catch (e) {
			console.error('[CHAT-CLIENT] startCall media failed', e);
			callError = media_error(e);
			mesh = null;
			callState = 'idle';
			return;
		}
		videoOn = localStream.getVideoTracks().length > 0;
		if (withVideo && !videoOn) callError = VIDEO_FALLBACK;
		try {
			await mesh.invite(data.peer);
			callState = 'calling';
		} catch (e) {
			console.error('[CHAT-CLIENT] startCall connect failed', e);
			callError = 'could not reach the other person — try again.';
			endCall();
		}
	}

	async function answerCall() {
		if (!mesh) return;
		callError = '';
		try {
			localStream = await mesh.open(videoOn);
		} catch (e) {
			console.error('[CHAT-CLIENT] answerCall media failed', e);
			callError = media_error(e);
			mesh = null;
			callState = 'idle';
			return;
		}
		const wanted_video = videoOn;
		videoOn = localStream.getVideoTracks().length > 0;
		if (wanted_video && !videoOn) callError = VIDEO_FALLBACK;
		try {
			await mesh.accept(data.peer);
			callState = 'connected';
		} catch (e) {
			console.error('[CHAT-CLIENT] answerCall connect failed', e);
			callError = 'could not connect the call — try again.';
			endCall();
		}
	}

	async function toggleVideo() {
		const next = !videoOn;
		callError = '';
		try {
			await mesh?.setVideo(next);
			videoOn = next;
		} catch (e) {
			console.error('[CHAT-CLIENT] toggleVideo failed', e);
			callError = media_error(e);
		}
	}

	function toggleMic() {
		micOn = !micOn;
		mesh?.setMic(micOn);
	}

	function endCall(silent = false) {
		mesh?.hangup(silent);
		resetCall();
	}

	function grow(e: Event) {
		const t = e.currentTarget as HTMLTextAreaElement;
		t.style.height = 'auto';
		t.style.height = Math.min(t.scrollHeight, 132) + 'px';
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
		mark_read();
		await tick();
		toBottom();
	});
</script>

<section class="chat mx-auto flex h-full max-w-[680px] flex-col">
	<header class="flex shrink-0 items-center gap-2.5 border-b border-line py-2.5">
		<button
			class="shrink-0 leading-none text-ink-soft transition-colors duration-300 hover:text-accent"
			onclick={() => goto('/app/chats')}
			aria-label="back"
		>
			<ArrowLeft size={18} />
		</button>
		<a href="/app/user/{data.peer}" class="flex min-w-0 flex-1 flex-col gap-0.5">
			<span
				class="truncate font-display text-[15px] font-medium tracking-[-0.01em] transition-colors duration-300 hover:text-accent"
				>{data.peer_name}</span
			>
			<span
				class="flex items-center gap-1.5 text-[9.5px] uppercase tracking-[0.18em] {online
					? 'text-accent'
					: 'text-faint'}"
			>
				<span class="h-1 w-1 rounded-full {online ? 'bg-accent' : 'bg-faint'}"></span>{online
					? 'online'
					: 'offline'}
			</span>
		</a>
		<div class="flex shrink-0 items-center gap-1.5">
			<AiThread conv={data.conv} peerName={data.peer_name} />
			<MuteButton target={data.peer} kind="u" bind:muted label="notifications from this person" />
			{#if callState === 'idle'}
				<button
					class="btn btn-icon"
					onclick={() => startCall(false)}
					aria-label="voice call"
					title="voice call"
				>
					<Phone size={15} />
				</button>
				<button
					class="btn btn-icon"
					onclick={() => startCall(true)}
					aria-label="video call"
					title="video call"
				>
					<Video size={15} />
				</button>
			{/if}
		</div>
	</header>

	{#if callError && callState === 'idle'}
		<p class="shrink-0 border-b border-line py-1.5 text-[11.5px] text-danger">{callError}</p>
	{/if}

	<div class="thread flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto py-4" bind:this={threadEl}>
		{#if !no_more && messages.length}
			<button
				class="btn btn-ghost mx-auto mb-2 text-[11px] text-mute"
				onclick={load_older}
				disabled={loading_older}
			>
				{loading_older ? 'loading…' : 'load older messages'}
			</button>
		{/if}
		{#each messages as m, i (m.cid ?? m.id)}
			{@const first_of_day = i === 0 || day_label(messages[i - 1].d) !== day_label(m.d)}
			{@const mine = m.f === me}
			{#if first_of_day}
				<div class="my-2 self-center rounded-full bg-panel-solid px-2.5 py-1 text-[10px] text-mute">
					{day_label(m.d)}
				</div>
			{/if}
			<div
				class="group relative flex max-w-[80%] flex-col gap-0.5 sm:max-w-[68%] {mine
					? 'items-end self-end'
					: 'self-start'}"
			>
				<div
					class="overflow-hidden px-3 py-2 text-[13.5px] leading-[1.45] {mine
						? 'rounded-[14px_4px_14px_14px] border border-accent bg-accent text-accent-ink'
						: 'rounded-[4px_14px_14px_14px] border border-line bg-panel-solid'}"
					class:border-0={m.sk}
					class:bg-transparent={m.sk}
					class:p-0={m.sk}
					class:opacity-60={m.id === '' && !m.err}
				>
					{#if m.fw}
						<div class="mb-1 text-[9.5px] uppercase tracking-[0.12em] opacity-60">forwarded</div>
					{/if}
					{#if m.sk}
						<img
							src={sticker_src(m.sk)}
							alt={m.sk + ' sticker'}
							class="h-[104px] w-[104px] object-contain"
						/>
					{:else}
						{#if m.rp}
							<div
								class="mb-1.5 truncate border-l-2 border-current/40 pl-2 text-[11.5px] opacity-70"
							>
								<span class="font-medium">{quoted[m.rp]?.f === me ? 'you' : data.peer_name}</span>
								<span class="opacity-80"> · {quoted[m.rp]?.x || 'original message'}</span>
							</div>
						{/if}
						{#if m.im}
							<a href={media_src(m.im)} target="_blank" rel="noopener noreferrer">
								<img
									src={media_src(m.im)}
									alt=""
									class="mb-1.5 max-h-[260px] w-full rounded-[8px] object-cover"
								/>
							</a>
						{/if}
						{#if m.fl?.type.startsWith('audio/')}
							<!-- a voice reply is the point of the note pool: it has to be
							     hearable in the thread, not a file to download -->
							<audio
								controls
								preload="none"
								src={media_src(m.fl.key)}
								class="mb-1.5 h-9 w-[220px] max-w-full"
							></audio>
						{:else if m.fl}
							<a
								href={media_src(m.fl.key)}
								target="_blank"
								rel="noopener noreferrer"
								class="mb-1.5 flex items-center gap-2 rounded-[8px] border border-current/20 px-2.5 py-1.5 text-[12px] no-underline"
							>
								<FileText size={14} class="shrink-0" />
								<span class="truncate">{m.fl.name}</span>
								<span class="opacity-60">{(m.fl.size / 1024).toFixed(0)}kb</span>
							</a>
						{/if}
						{#if m.x}<span class="whitespace-pre-wrap break-words">{m.x}</span>{/if}
					{/if}
				</div>

				{#if m.rx && Object.keys(m.rx).length}
					<div class="-mt-1 flex flex-wrap gap-1">
						{#each Object.entries(m.rx).slice(0, 3) as [emoji, uids] (emoji)}
							<button
								type="button"
								class="flex items-center gap-1 rounded-full border border-line bg-panel-solid px-1.5 py-0.5 text-[11px]"
								class:border-accent={uids.includes(me)}
								onclick={() => react(m.id, emoji)}
							>
								{emoji}
								{uids.length}
							</button>
						{/each}
						{#if Object.keys(m.rx).length > 3}
							<button
								type="button"
								class="rounded-full border border-line bg-panel-solid px-1.5 py-0.5 text-[11px] text-mute"
								onclick={() => (reactionListFor = m.id)}>+{Object.keys(m.rx).length - 3}</button
							>
						{/if}
					</div>
				{/if}

				{#if m.err}
					<button class="text-[10.5px] text-danger underline" onclick={() => send(m)}>
						not sent — retry
					</button>
				{:else}
					<time class="px-1 text-[9.5px] tabular-nums text-mute">{clock(m.d)}</time>
				{/if}

				<!-- absolutely placed so the row reserves no height when nobody is hovering -->
				<div
					class="absolute -top-2.5 z-10 flex items-center gap-0.5 rounded-full border border-line bg-panel-solid px-1 py-0.5 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 {mine
						? 'right-1'
						: 'left-1'}"
				>
					<button
						type="button"
						class="p-1 text-mute hover:text-accent"
						aria-label="reply"
						title="reply"
						onclick={() => (replyTo = m)}><CornerUpLeft size={12} /></button
					>
					<button
						type="button"
						class="p-1 text-mute hover:text-accent"
						aria-label="react"
						title="react"
						onclick={() => (reactingTo = m.id)}><SmilePlus size={12} /></button
					>
					<button
						type="button"
						class="p-1 text-mute hover:text-accent"
						aria-label="forward"
						title="forward"
						onclick={() => openForward(m)}><Forward size={12} /></button
					>
				</div>
			</div>
		{/each}
	</div>

	{#if replyTo}
		<div
			class="flex shrink-0 items-center gap-2 border-t border-line px-1 py-1.5 text-[11.5px] text-ink-soft"
		>
			<div class="min-w-0 flex-1 truncate border-l-2 border-accent pl-2">
				<span class="font-medium">{replyTo.f === me ? 'you' : data.peer_name}</span>
				<span class="opacity-80"> · {replyTo.x || '(attachment)'}</span>
			</div>
			<button
				type="button"
				class="text-mute hover:text-accent"
				onclick={() => (replyTo = null)}
				aria-label="cancel reply">&times;</button
			>
		</div>
	{/if}

	{#if showSchedule}
		<div
			class="flex shrink-0 items-center gap-2 border-t border-line pt-2.5 text-[12px] text-ink-soft"
		>
			<label for="schedule-at">send at</label>
			<input id="schedule-at" type="datetime-local" bind:value={scheduleAt} />
		</div>
	{/if}

	<form
		class="flex shrink-0 items-end gap-1.5 border-t border-line py-2.5"
		use:ctrlEnter={() => send()}
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
			class="btn btn-icon cursor-pointer {pendingFile ? 'border-accent text-accent' : ''}"
			aria-label="attach file"
			title={pendingFile ? pendingFile.name : 'attach file'}
		>
			<Paperclip size={15} />
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
			class="btn btn-icon max-sm:hidden"
			aria-label="sticker"
			title="send a sticker"
			onclick={() => (stickerOpen = true)}
		>
			<Sticker size={15} />
		</button>
		<button
			type="button"
			class="btn btn-icon"
			aria-label="emoji"
			title="insert an emoji"
			onclick={openEmoji}
		>
			<Smile size={15} />
		</button>
		<textarea
			class="max-h-[132px] min-w-0 flex-1 resize-none py-2 leading-[1.4]"
			rows="1"
			bind:this={composerInput}
			bind:value={text}
			oninput={grow}
			placeholder="write something considered… ⌃⏎ to send"
			autocomplete="off"
			onpaste={(e) => {
				const f = image_from_event(e);
				if (f) pendingFile = f;
			}}></textarea>
		<button
			type="button"
			class="btn btn-icon max-sm:hidden"
			class:btn-amber={showSchedule || scheduleAt}
			aria-label="schedule send"
			title="schedule send"
			onclick={() => (showSchedule = !showSchedule)}
		>
			<Clock size={15} />
		</button>
		<button
			class="btn btn-amber btn-icon"
			type="submit"
			disabled={busy}
			aria-label="send message"
			title="send"
		>
			<SendIcon size={15} />
		</button>
	</form>
</section>

{#if callState !== 'idle'}
	<CallOverlay
		phase={callState}
		title={data.peer_name}
		{peers}
		local={localStream}
		{micOn}
		{videoOn}
		error={callError}
		onaccept={answerCall}
		ondecline={() => endCall()}
		onhangup={() => endCall()}
		ontogglemic={toggleMic}
		ontogglevideo={toggleVideo}
	/>
{/if}

{#if reactingTo}
	<Modal open onclose={() => (reactingTo = null)} title="react">
		<EmojiPicker onselect={(e) => react(reactingTo!, e)} onclose={() => (reactingTo = null)} />
	</Modal>
{/if}
{#if reactionListFor}
	<Modal open onclose={() => (reactionListFor = null)} title="reactions">
		<div class="flex flex-col gap-2">
			{#each Object.entries(messages.find((e) => e.id === reactionListFor)?.rx ?? {}) as [emoji, uids] (emoji)}
				<div class="flex items-center gap-2 text-[13px]">
					<span>{emoji}</span>
					<span>{uids.map((u) => (u === me ? 'you' : data.peer_name)).join(', ')}</span>
				</div>
			{/each}
		</div>
	</Modal>
{/if}

{#if stickerOpen}
	<Modal open onclose={() => (stickerOpen = false)} title="stickers">
		<StickerPicker onselect={(e) => sendSticker(e)} />
	</Modal>
{/if}

{#if emojiOpen}
	<Modal open onclose={() => (emojiOpen = false)} title="emoji">
		<EmojiPicker onselect={insertEmoji} onclose={() => (emojiOpen = false)} />
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
			<p class="text-[12px] text-faint">loading…</p>
		{/if}
	</Modal>
{/if}
