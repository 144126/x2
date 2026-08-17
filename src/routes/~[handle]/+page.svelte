<script lang="ts">
	import { goto, pushState, invalidateAll } from '$app/navigation';
	import { page } from '$app/stores';
	import { onMount, onDestroy, tick } from 'svelte';
	import { ws_on, ws_send } from '$lib/ws';
	import { profile_url } from '$lib/links';
	import { confirm_sent, mark_failed } from '$lib/chat_optimistic';
	import { upload, media_src, image_from_event } from '$lib/attach';
	import { mark_first_send } from '$lib/notify-trigger';
	import type { Message } from '$lib/types';
	import { CallMesh, media_error, VIDEO_FALLBACK, type CallSignal } from '$lib/call';
	import CallOverlay from '$lib/components/CallOverlay.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import EmojiPicker from '$lib/components/EmojiPicker.svelte';
	import StickerPicker from '$lib/components/StickerPicker.svelte';
	import ForwardPicker from '$lib/components/ForwardPicker.svelte';
	import { sticker_src } from '$lib/stickers';
	import { day_label, clock } from '$lib/time';
	import { ctrlEnter } from '$lib/actions';
	import AiThread from '$lib/components/AiThread.svelte';
	import MuteButton from '$lib/components/MuteButton.svelte';
	import LocationPicker from '$lib/LocationPicker.svelte';
	import {
		ArrowLeft,
		Image,
		Send as SendIcon,
		Phone,
		Video,
		Smile,
		Sticker,
		CornerUpLeft,
		SmilePlus,
		Forward,
		MessageSquare
	} from '@lucide/svelte';

	type FileAttach = { key: string; name: string; size: number; type: string };
	type Row = Message & { cid?: string; err?: boolean; fl?: FileAttach };
	let { data } = $props();
	let g = $state(data.g);
	let messages = $state(data.messages as Row[]);
	let names = $state<Record<string, string>>(data.names);
	let muted = $state(data.muted as boolean);
	let text = $state('');
	let pending: File | null = $state(null);
	let busy = $state(false);
	let unsub: (() => void) | null = null;

	let me = $derived($page.data.user?.id);
	let mine = $derived(!!me && g.members.includes(me));
	let owner = $derived(!!me && g.owner === me);

	let aboutOpen = $state(false);
	let ename = $state(g.name);
	let edesc = $state(g.description);
	let ecountry = $state(g.country ?? '');
	let eregion = $state(g.state ?? '');
	let ecity = $state(g.city ?? '');
	let etags = $state(g.tags ?? []);
	let etagInput = $state('');
	let eroom_state = $state(g.roomState ?? 'a');
	function eaddTag() {
		const t = etagInput.trim();
		if (t && !etags.includes(t)) etags = [...etags, t];
		etagInput = '';
	}
	function eremoveTag(t: string) {
		etags = etags.filter((x) => x !== t);
	}

	let mesh: CallMesh | null = null;
	let inCall = $state(false);
	let localStream = $state<MediaStream | null>(null);
	let remotes = $state<{ uid: string; stream: MediaStream }[]>([]);
	let micOn = $state(true);
	let videoOn = $state(false);
	let callError = $state('');
	let call_peers = $derived(
		remotes.map((r) => ({ uid: r.uid, name: names[r.uid] ?? 'someone', stream: r.stream }))
	);

	function makeMesh(): CallMesh {
		return new CallMesh({
			me: me!,
			send: (to, signal) => ws_send({ type: 'signal', to, signal, ctx: `room:${g.id}` }),
			onremote: (uid, stream) => {
				remotes = stream
					? [...remotes.filter((r) => r.uid !== uid), { uid, stream }]
					: remotes.filter((r) => r.uid !== uid);
			},
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

	async function joinCall(withVideo = false) {
		callError = '';
		videoOn = withVideo;
		mesh ??= makeMesh();
		try {
			localStream = await mesh.open(videoOn);
		} catch (e) {
			console.error('[ROOM-CLIENT] joinCall media failed', e);
			callError = media_error(e);
			mesh = null;
			return;
		}
		videoOn = localStream.getVideoTracks().length > 0;
		if (withVideo && !videoOn) callError = VIDEO_FALLBACK;
		inCall = true;
		mesh.announce(g.members);
	}

	function leaveCall(silent = false) {
		mesh?.hangup(silent);
		mesh = null;
		inCall = false;
		localStream = null;
		remotes = [];
		micOn = true;
		videoOn = false;
	}

	function toggleMic() {
		micOn = !micOn;
		mesh?.setMic(micOn);
	}

	async function toggleVideo() {
		const next = !videoOn;
		callError = '';
		try {
			await mesh?.setVideo(next);
			videoOn = next;
		} catch (e) {
			console.error('[ROOM-CLIENT] toggleVideo failed', e);
			callError = media_error(e);
		}
	}

	let thread: HTMLDivElement | undefined = $state();
	function scroll_down() {
		requestAnimationFrame(() => thread?.scrollTo({ top: thread.scrollHeight }));
	}

	let loading_older = $state(false);
	let no_more = $state(false);

	let replyTo = $state<Row | null>(null);

	function startReply(m: Row) {
		replyTo = m;
	}

	function cancelReply() {
		replyTo = null;
	}

	let quoted = $state<Record<string, Row | null>>({});
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

	function grow(e: Event) {
		const t = e.currentTarget as HTMLTextAreaElement;
		t.style.height = 'auto';
		t.style.height = Math.min(t.scrollHeight, 132) + 'px';
	}

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
		const row: Row = {
			s: 'm',
			id: '',
			cid: crypto.randomUUID(),
			c: '',
			f: me!,
			t: '',
			gr: g.id,
			x: '',
			sk: id,
			d: Date.now()
		};
		messages = [...messages, row];
		scroll_down();
		const res = await fetch('/api/send', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ group: g.id, sticker: id })
		}).catch(() => null);
		if (!res?.ok) {
			messages = mark_failed(messages, row.cid!);
			return;
		}
		mark_first_send();
		const { m } = await res.json();
		if (m) messages = confirm_sent(messages, row.cid!, { id: m.id, d: m.ts });
	}

	let forwarding = $state<Row | null>(null);
	let forwardData = $state<{
		conversations: { peer: string }[];
		rooms: { id: string; name: string }[];
	} | null>(null);
	async function openForward(m: Row) {
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
		const res = await fetch(`/api/messages?g=${g.id}&before=${before}`).catch(() => null);
		if (res?.ok) {
			const older = (await res.json()).r as Row[];
			if (!older.length) no_more = true;
			else messages = [...older, ...messages];
		}
		loading_older = false;
	}

	async function send(retry?: Row) {
		const body = retry ? retry.x : text.trim();
		if ((!body && !pending && !retry) || busy) return;

		let image: string | undefined;
		if (!retry && pending) {
			busy = true;
			const r = await upload(pending).promise;
			busy = false;
			if (r.error) return;
			image = r.key;
			pending = null;
		}

		if (!retry) {
			text = '';
			if (composerInput) composerInput.style.height = 'auto';
		}

		let row: Row | undefined;
		if (retry) {
			retry.err = false;
			row = retry;
		} else {
			row = {
				s: 'm',
				id: '',
				cid: crypto.randomUUID(),
				c: '',
				f: me!,
				t: '',
				gr: g.id,
				x: body,
				im: image,
				d: Date.now(),
				rp: replyTo?.id
			};
			messages = [...messages, row];
			scroll_down();
		}

		const res = await fetch('/api/send', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ group: g.id, text: body, image, reply_to: replyTo?.id })
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

	async function membership(action: 'join' | 'leave') {
		const res = await fetch(`/api/groups/${g.id}`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ action })
		});
		if (res.ok) {
			g = (await res.json()).g;
			if (!me) await invalidateAll();
		}
	}

	async function save_edits() {
		const res = await fetch(`/api/groups/${g.id}`, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				name: ename,
				description: edesc,
				country: ecountry,
				state: eregion,
				city: ecity,
				tags: etags,
				room_state: eroom_state
			})
		});
		if (res.ok) {
			g = (await res.json()).g;
			history.back();
		}
	}

	async function remove() {
		const res = await fetch(`/api/groups/${g.id}`, { method: 'DELETE' });
		if (res.ok) goto('/rooms');
	}

	function onpick(e: Event) {
		const f = (e.currentTarget as HTMLInputElement).files?.[0];
		if (f) pending = f;
	}

	function add_msg(m: Row) {
		if (m.id && messages.some((e) => e.id === m.id)) return;
		messages = [...messages, m];
		scroll_down();
	}

	onMount(() => {
		unsub = ws_on((m) => {
			if (m.type === 'ws_down') return leaveCall(true);
			if (m.type === 'signal') {
				if (m.ctx !== `room:${g.id}`) return;
				if (!g.members.includes(m.from as string)) return;
				mesh ??= makeMesh();
				mesh.handle(m.from as string, m.signal as CallSignal);
				return;
			}
			if (m.type === 'reaction') {
				messages = messages.map((e) =>
					e.id === m.id ? { ...e, rx: m.rx as Record<string, string[]> } : e
				);
				return;
			}
			if (m.type === 'edit') {
				messages = messages.map((e) =>
					e.id === m.id ? { ...e, x: m.text as string, e: m.ts as number } : e
				);
				return;
			}
			if (m.type === 'delete') {
				messages = messages.filter((e) => e.id !== m.id);
				return;
			}
			if (m.type !== 'msg' || m.group !== g.id) return;
			names = { ...names, [m.from as string]: (m.from_name as string) ?? (m.from as string) };
			add_msg({
				s: 'm',
				id: m.id as string,
				c: '',
				f: m.from as string,
				t: '',
				gr: g.id,
				x: (m.text as string) ?? '',
				im: m.image as string | undefined,
				sk: m.sticker as string | undefined,
				fw: m.fw as boolean | undefined,
				d: m.ts as number
			});
		});
		scroll_down();
	});
	onDestroy(() => {
		leaveCall();
		unsub?.();
	});
</script>

<section class="mx-auto flex h-full max-w-[680px] flex-col">
	<header class="flex shrink-0 items-center gap-2.5 border-b border-line py-2.5">
		<button
			class="shrink-0 leading-none text-ink-soft transition-colors duration-300 hover:text-accent"
			onclick={() => goto('/rooms')}
			aria-label="back"
		>
			<ArrowLeft size={18} />
		</button>
		<button
			class="flex min-w-0 flex-1 flex-col gap-0.5 text-left"
			onclick={() => (aboutOpen = true)}
			title="about this room"
		>
			<span
				class="truncate font-display text-[15px] font-medium tracking-[-0.01em] transition-colors duration-300 hover:text-accent"
				>{g.name}</span
			>
			<span class="text-[9.5px] uppercase tracking-[0.18em] text-faint"
				>{g.members.length} member{g.members.length === 1 ? '' : 's'}{inCall
					? ` · in call`
					: ''}</span
			>
		</button>
		<div class="flex shrink-0 items-center gap-1.5">
			{#if mine && !inCall}
				<button
					class="btn btn-icon"
					onclick={() => joinCall(false)}
					aria-label="join the call"
					title="join the call"
				>
					<Phone size={15} />
				</button>
				<button
					class="btn btn-icon"
					onclick={() => joinCall(true)}
					aria-label="join with video"
					title="join with video"
				>
					<Video size={15} />
				</button>
			{/if}
			{#if mine}
				<AiThread conv="g:{g.id}" peerName={g.name} />
				<MuteButton target={g.id} kind="r" bind:muted label="notifications for this room" />
			{/if}
			{#if owner}
				<button class="btn" onclick={() => pushState('', { modal: 'edit-room' })}>edit</button>
			{:else if mine}
				<button class="btn" onclick={() => membership('leave')}>leave</button>
			{:else}
				<button class="btn btn-amber" onclick={() => membership('join')}>join</button>
			{/if}
		</div>
	</header>

	{#if callError && !inCall}
		<p class="shrink-0 border-b border-line py-1.5 text-[11.5px] text-danger">{callError}</p>
	{/if}

	<Modal open={$page.state.modal === 'edit-room'} onclose={() => history.back()} title="edit room">
		<form class="flex flex-col gap-3" onsubmit={(e) => (e.preventDefault(), save_edits())}>
			<input bind:value={ename} placeholder="room name" maxlength="60" />
			<textarea bind:value={edesc} rows="2" placeholder="what this room is about (used for search)"
			></textarea>
			<select bind:value={eroom_state} aria-label="room state">
				<option value="a">active</option>
				<option value="p">paused</option>
				<option value="c">closed</option>
			</select>
			<div
				class="flex min-h-[38px] flex-wrap items-center gap-2 rounded-[10px] border border-line bg-panel-solid px-3 py-2 transition-colors duration-300 focus-within:border-accent"
			>
				{#each etags as t}
					<span
						class="flex items-center gap-1 rounded-full border border-line bg-panel px-3 py-1 text-[13px] text-ink"
					>
						{t}
						<button
							type="button"
							onclick={() => eremoveTag(t)}
							class="text-[15px] leading-none text-faint transition-colors hover:text-accent"
							aria-label="remove {t}">&times;</button
						>
					</span>
				{/each}
				<input
					class="min-w-[100px] flex-1 border-none bg-transparent px-1 py-1 text-[14px] text-ink outline-none placeholder:text-mute"
					bind:value={etagInput}
					onkeydown={(e) => {
						if (e.key === 'Enter') (e.preventDefault(), eaddTag());
					}}
					placeholder={etags.length ? '' : 'add a tag…'}
				/>
			</div>
			<LocationPicker
				bind:country={ecountry}
				bind:region={eregion}
				bind:city={ecity}
				anyLabel="no country"
			/>
			<div class="flex gap-2">
				<button class="btn btn-amber px-4 py-2 text-[12px]" type="submit">save</button>
				<button class="btn px-4 py-2 text-[12px] text-red-400" type="button" onclick={remove}
					>delete room</button
				>
			</div>
		</form>
	</Modal>

	<Modal bind:open={aboutOpen} title={g.name}>
		<div class="flex flex-col gap-4">
			{#if g.description}
				<p class="text-[14.5px] leading-[1.6] text-ink-soft">{g.description}</p>
			{:else}
				<p class="text-[14px] text-faint">no description yet.</p>
			{/if}
			{#if g.city || g.state || g.country}
				<div class="flex items-baseline gap-3">
					<span class="eyebrow w-[100px] shrink-0">location</span>
					<span class="text-[14px] text-ink">
						{[g.city, g.state, g.country].filter(Boolean).join(' · ')}
					</span>
				</div>
			{/if}
			<div class="flex items-baseline gap-3">
				<span class="eyebrow w-[100px] shrink-0">members</span>
				<span class="text-[14px] text-ink">{g.members.length}</span>
			</div>
			<ul class="flex flex-col gap-1">
				{#each g.members as uid}
					<li>
						<a href={profile_url(names[uid], uid)} class="text-[14px] text-accent hover:underline"
							>{names[uid] ?? 'someone'}</a
						>
					</li>
				{/each}
			</ul>
		</div>
	</Modal>

	<div bind:this={thread} class="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto py-4">
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
			{@const own = m.f === me}
			{#if first_of_day}
				<div class="my-2 self-center rounded-full bg-panel-solid px-2.5 py-1 text-[10px] text-mute">
					{day_label(m.d)}
				</div>
			{/if}
			<div
				class="group relative flex max-w-[80%] flex-col gap-0.5 sm:max-w-[68%] {own
					? 'items-end self-end'
					: 'self-start'}"
			>
				{#if !own}
					<a
						href={profile_url(names[m.f], m.f)}
						class="px-1 text-[10px] uppercase tracking-[0.14em] text-mute hover:text-accent"
						>{names[m.f] ?? 'someone'}</a
					>
				{/if}
				<div
					class="overflow-hidden px-3 py-2 text-[13.5px] leading-[1.45] {own
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
								<span class="font-medium"
									>{names[quoted[m.rp]?.f ?? ''] ??
										(quoted[m.rp]?.f === me ? 'you' : 'someone')}</span
								>
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

				<div
					class="absolute -top-2.5 z-10 flex items-center gap-0.5 rounded-full border border-line bg-panel-solid px-1 py-0.5 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 {own
						? 'right-1'
						: 'right-1 sm:left-1 sm:right-auto'}"
				>
					<button
						type="button"
						class="p-1 text-mute hover:text-accent"
						aria-label="reply"
						title="reply"
						onclick={() => startReply(m)}><CornerUpLeft size={12} /></button
					>
					{#if !own}
						<button
							type="button"
							class="p-1 text-mute hover:text-accent"
							aria-label="reply privately"
							title="reply privately"
							onclick={() => goto(`/chat/${m.f}?reply=${m.id}`)}><MessageSquare size={12} /></button
						>
					{/if}
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
		{#if !messages.length}
			<p class="text-[13px] text-faint">nothing here yet. say the first thing.</p>
		{/if}
	</div>

	{#if reactingTo}
		<Modal open onclose={() => (reactingTo = null)} title="react">
			<EmojiPicker onselect={(e) => react(reactingTo!, e)} onclose={() => (reactingTo = null)} />
		</Modal>
	{/if}
	{#if reactionListFor}
		<Modal open onclose={() => (reactionListFor = null)} title="reactions">
			<div class="flex flex-col gap-2">
				{#each Object.entries(messages.find((e) => e.id === reactionListFor)?.rx ?? {}) as [emoji, uids] (emoji)}
					<div class="flex items-center gap-2 text-[14px]">
						<span>{emoji}</span>
						<span>{uids.map((u) => names[u] ?? 'someone').join(', ')}</span>
					</div>
				{/each}
			</div>
		</Modal>
	{/if}

	{#if stickerOpen}
		<Modal open onclose={() => (stickerOpen = false)} title="sticker">
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
				<p class="text-[13px] text-faint">loading…</p>
			{/if}
		</Modal>
	{/if}

	{#if mine}
		{#if replyTo}
			<div
				class="flex shrink-0 items-center gap-2 border-t border-line px-1 py-1.5 text-[11.5px] text-ink-soft"
			>
				<div class="min-w-0 flex-1 truncate border-l-2 border-accent pl-2">
					<span class="font-medium"
						>{names[replyTo.f] ?? (replyTo.f === me ? 'you' : 'someone')}</span
					>
					<span class="opacity-80"> · {replyTo.x || '(attachment)'}</span>
				</div>
				<button
					type="button"
					class="text-mute hover:text-accent"
					onclick={cancelReply}
					aria-label="cancel reply">&times;</button
				>
			</div>
		{/if}
		<form
			class="flex shrink-0 items-end gap-1.5 border-t border-line py-2.5"
			use:ctrlEnter={() => send()}
			onsubmit={(e) => (e.preventDefault(), send())}
			ondragover={(e) => e.preventDefault()}
			ondrop={(e) => {
				const f = image_from_event(e);
				if (f) {
					e.preventDefault();
					pending = f;
				}
			}}
		>
			<label
				class="btn btn-icon cursor-pointer {pending ? 'border-accent text-accent' : ''}"
				aria-label="attach image"
				title={pending ? pending.name : 'attach image'}
			>
				<Image size={15} />
				<input type="file" accept="image/*" class="hidden" onchange={onpick} />
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
				placeholder="say something to the room… ⌃⏎ to send"
				autocomplete="off"
				onpaste={(e) => {
					const f = image_from_event(e);
					if (f) pending = f;
				}}></textarea>
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
	{:else}
		<p class="shrink-0 border-t border-line py-3 text-[13px] text-faint">join the room to post.</p>
	{/if}
</section>

{#if inCall}
	<CallOverlay
		phase="connected"
		title={g.name}
		peers={call_peers}
		local={localStream}
		{micOn}
		{videoOn}
		error={callError}
		onhangup={() => leaveCall()}
		ontogglemic={toggleMic}
		ontogglevideo={toggleVideo}
	/>
{/if}

<style>
	input[type='file'] {
		display: none;
	}
</style>
