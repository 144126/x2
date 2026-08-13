<script lang="ts">
	import { goto, pushState, invalidateAll } from '$app/navigation';
	import { page } from '$app/stores';
	import { onMount, onDestroy, tick } from 'svelte';
	import { ws_on, ws_send } from '$lib/ws';
	import { confirm_sent, mark_failed } from '$lib/chat_optimistic';
	import { upload_image, media_src, image_from_event } from '$lib/attach';
	import { mark_first_send } from '$lib/notify-trigger';
	import type { Message } from '$lib/types';
	import { CallMesh, media_error, VIDEO_FALLBACK, type CallSignal } from '$lib/call';
	import RemoteVideo from '$lib/components/RemoteVideo.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import EmojiPicker from '$lib/components/EmojiPicker.svelte';
	import StickerPicker from '$lib/components/StickerPicker.svelte';
	import ForwardPicker from '$lib/components/ForwardPicker.svelte';
	import { sticker_src } from '$lib/stickers';
	import AiThread from '$lib/components/AiThread.svelte';
	import MuteButton from '$lib/components/MuteButton.svelte';
	import LocationPicker from '$lib/LocationPicker.svelte';
	import {
		ArrowLeft,
		Image,
		Send as SendIcon,
		Phone,
		PhoneOff,
		Mic,
		MicOff,
		Video,
		VideoOff,
		Smile
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
	let composerInput: HTMLInputElement | undefined = $state();
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
			const r = await upload_image(pending);
			busy = false;
			if (r.error) return;
			image = r.key;
			pending = null;
		}

		if (!retry) text = '';

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
				country: ecountry || undefined,
				state: eregion || undefined,
				city: ecity || undefined,
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
		if (res.ok) goto('/app/rooms');
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

<section class="mx-auto flex h-[calc(100dvh-var(--chrome))] max-w-[760px] flex-col">
	<header class="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line py-4">
		<button
			class="bg-none leading-none text-ink-soft transition-colors duration-300 hover:text-accent"
			onclick={() => goto('/app/rooms')}
			aria-label="back"
		>
			<ArrowLeft size={22} />
		</button>
		<div class="flex min-w-0 flex-col gap-0.5">
			<button
				class="truncate text-left font-display text-[21px] font-medium tracking-[-0.01em] transition-colors duration-300 hover:text-accent"
				onclick={() => (aboutOpen = true)}
				title="about this room">{g.name}</button
			>
			<span class="text-[10.5px] uppercase tracking-[0.2em] text-faint"
				>{g.members.length} member{g.members.length === 1 ? '' : 's'}</span
			>
		</div>
		<div class="ml-auto flex flex-wrap items-center gap-2">
			{#if mine && !inCall}
				<button
					class="btn btn-ghost flex items-center gap-1.5 px-4 py-2 text-[12px]"
					onclick={() => joinCall(false)}
				>
					<Phone size={14} /> join call
				</button>
				<button
					class="btn btn-ghost flex items-center gap-1.5 px-4 py-2 text-[12px]"
					onclick={() => joinCall(true)}
				>
					<Video size={14} /> join with video
				</button>
			{/if}
			{#if mine}
				<AiThread conv="g:{g.id}" peerName={g.name} />
				<MuteButton target={g.id} kind="r" bind:muted label="notifications for this room" />
			{/if}
			{#if inCall}
				<button
					class="btn btn-ghost flex items-center gap-1.5 px-3 py-2 text-[12px]"
					onclick={toggleMic}
				>
					{#if micOn}<Mic size={14} />{:else}<MicOff size={14} />{/if}
				</button>
				<button
					class="btn btn-ghost flex items-center gap-1.5 px-3 py-2 text-[12px]"
					onclick={toggleVideo}
				>
					{#if videoOn}<Video size={14} />{:else}<VideoOff size={14} />{/if}
				</button>
				<button
					class="btn btn-ghost flex items-center gap-1.5 px-4 py-2 text-[12px] text-red-500"
					onclick={() => leaveCall()}
				>
					<PhoneOff size={14} /> leave
				</button>
			{/if}
			{#if owner}
				<button
					class="btn px-4 py-2 text-[12px]"
					onclick={() => pushState('', { modal: 'edit-room' })}>edit</button
				>
			{:else if mine}
				<button class="btn px-4 py-2 text-[12px]" onclick={() => membership('leave')}
					>leave room</button
				>
			{:else}
				<button class="btn btn-amber px-4 py-2 text-[12px]" onclick={() => membership('join')}
					>join</button
				>
			{/if}
		</div>
	</header>

	{#if callError}
		<p class="border-b border-line py-2 text-[12.5px] text-[#e2674c]">{callError}</p>
	{/if}

	{#if inCall}
		<div class="flex flex-wrap items-center gap-3 border-b border-line py-3">
			<span class="eyebrow mr-1">in call · {remotes.length + 1}</span>
			{#if localStream}
				<RemoteVideo
					stream={localStream}
					muted
					class="h-20 w-28 rounded-[10px] border border-accent bg-black object-cover"
				/>
			{/if}
			{#each remotes as r (r.uid)}
				<div class="flex flex-col items-center gap-1">
					<RemoteVideo
						stream={r.stream}
						class="h-20 w-28 rounded-[10px] border border-line bg-black object-cover"
					/>
					<span class="max-w-[112px] truncate text-[10.5px] text-mute"
						>{names[r.uid] ?? 'someone'}</span
					>
				</div>
			{/each}
		</div>
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
				class="flex min-h-[48px] flex-wrap items-center gap-2 rounded-[12px] border border-line bg-panel-solid px-3 py-2 transition-colors duration-300 focus-within:border-accent"
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
				anyLabel="country"
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
						<a href="/app/user/{uid}" class="text-[14px] text-accent hover:underline"
							>{names[uid] ?? 'someone'}</a
						>
					</li>
				{/each}
			</ul>
		</div>
	</Modal>

	<div bind:this={thread} class="flex flex-1 flex-col gap-3 overflow-y-auto py-6">
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
				{#if m.f !== me}
					<a
						href="/app/user/{m.f}"
						class="text-[11px] uppercase tracking-[0.16em] text-mute hover:text-accent"
						>{names[m.f] ?? 'someone'}</a
					>
				{/if}
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
								<span class="font-medium"
									>{names[quoted[m.rp]?.f ?? ''] ??
										(quoted[m.rp]?.f === me ? 'You' : 'someone')}</span
								>
								<span class="opacity-80"> · {quoted[m.rp]?.x || 'original message'}</span>
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
										{emoji}
										{uids.length}
									</button>
								{/each}
								{#if Object.keys(m.rx).length > 3}
									<button
										type="button"
										class="rounded-full border border-line bg-panel px-2 py-0.5 text-[12px] text-mute"
										onclick={() => (reactionListFor = m.id)}>+{Object.keys(m.rx).length - 3}</button
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
						onclick={() => startReply(m)}>reply</button
					>
					{#if m.f !== me}
						<button
							type="button"
							class="text-[11px] text-faint hover:text-accent"
							onclick={() => goto(`/app/chat/${m.f}?reply=${m.id}`)}>reply privately</button
						>
					{/if}
					<button
						type="button"
						class="text-[11px] text-faint hover:text-accent"
						onclick={() => (reactingTo = m.id)}>react</button
					>
					<button
						type="button"
						class="text-[11px] text-faint hover:text-accent"
						onclick={() => openForward(m)}>forward</button
					>
				</div>
			</div>
		{/each}
		{#if !messages.length}
			<p class="text-[14.5px] text-faint">nothing here yet. say the first thing.</p>
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
			<StickerPicker onselect={(e) => sendSticker(e)} onclose={() => (stickerOpen = false)} />
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
				class="flex items-center gap-2 border-t border-line px-1 py-2 text-[12.5px] text-ink-soft"
			>
				<div class="min-w-0 flex-1 truncate border-l-2 border-accent pl-2">
					<span class="font-medium"
						>{names[replyTo.f] ?? (replyTo.f === me ? 'You' : 'someone')}</span
					>
					<span class="opacity-80"> · {replyTo.x || '(attachment)'}</span>
				</div>
				<button
					type="button"
					class="text-faint hover:text-accent"
					onclick={cancelReply}
					aria-label="cancel reply">&times;</button
				>
			</div>
		{/if}
		<form
			class="flex flex-wrap items-center gap-2 border-t border-line py-4"
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
				class="btn shrink-0 cursor-pointer px-3 py-3"
				aria-label="attach image"
				title={pending ? pending.name : 'attach image'}
			>
				<span class="flex items-center gap-1">
					<Image size={16} />{#if pending}<span class="text-[11px]">1</span>{/if}
				</span>
				<input type="file" accept="image/*" class="hidden" onchange={onpick} />
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
			<button
				type="button"
				class="btn shrink-0 px-3 py-3"
				aria-label="emoji"
				title="insert an emoji"
				onclick={openEmoji}
			>
				<Smile size={16} />
			</button>
			<input
				class="min-w-0 flex-1 text-[15px]"
				bind:this={composerInput}
				bind:value={text}
				placeholder="say something to the room…"
				autocomplete="off"
				onpaste={(e) => {
					const f = image_from_event(e);
					if (f) pending = f;
				}}
			/>
			<button
				class="btn btn-amber shrink-0 !px-4"
				type="submit"
				disabled={busy}
				aria-label="send message"
				title="send"
			>
				<SendIcon size={16} />
			</button>
		</form>
	{:else}
		<p class="border-t border-line py-4 text-[14px] text-faint">join the room to post.</p>
	{/if}
</section>

<style>
	input[type='file'] {
		display: none;
	}
</style>
