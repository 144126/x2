<script lang="ts">
	import { goto, pushState, invalidateAll } from '$app/navigation';
	import { page } from '$app/stores';
	import { onMount, onDestroy, tick } from 'svelte';
	import { ws_on, ws_send } from '$lib/ws';
	import { profile_url } from '$lib/links';
	import { confirm_sent, mark_failed } from '$lib/chat_optimistic';
	import { upload, image_from_event } from '$lib/attach';
	import MessageRow from '$lib/components/MessageRow.svelte';
	import MediaViewer from '$lib/components/MediaViewer.svelte';
	import { failed, openable, pending, type Row, type Up } from '$lib/msg';
	import { mark_first_send } from '$lib/notify-trigger';
	import { CallMesh, media_error, VIDEO_FALLBACK, type CallSignal } from '$lib/call';
	import CallOverlay from '$lib/components/CallOverlay.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import EmojiPicker from '$lib/components/EmojiPicker.svelte';
	import StickerPicker from '$lib/components/StickerPicker.svelte';
	import ForwardPicker from '$lib/components/ForwardPicker.svelte';
	import { day_label } from '$lib/time';
	import { ctrlEnter } from '$lib/actions';
	import AiThread from '$lib/components/AiThread.svelte';
	import MuteButton from '$lib/components/MuteButton.svelte';
	import LocationPicker from '$lib/LocationPicker.svelte';
	import {
		ArrowLeft,
		Image,
		Eye,
		Send as SendIcon,
		Phone,
		Video,
		Smile,
		Sticker
	} from '@lucide/svelte';

	let { data } = $props();
	let g = $state(data.g);
	let messages = $state(data.messages as Row[]);
	let names = $state<Record<string, string>>(data.names);
	let muted = $state(data.muted as boolean);
	let text = $state('');
	let pendingFiles = $state<File[]>([]);
	let view_once = $state(false);
	let viewing = $state<Row | null>(null);
	// cid -> the File, so a failed send can be retried from the row it left behind
	let files: Record<string, File> = {};
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

	// the box only ever scrolls once it has stopped growing. Without this a phone scrolls the
	// first line out of sight for the moment between the keystroke and the resize.
	function grow(e: Event) {
		const t = e.currentTarget as HTMLTextAreaElement;
		t.style.height = 'auto';
		const h = Math.min(t.scrollHeight, 132);
		t.style.height = h + 'px';
		t.style.overflowY = t.scrollHeight > 132 ? 'auto' : 'hidden';
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

	function patch(cid: string, over: Partial<Row>) {
		messages = messages.map((e) => (e.cid === cid ? { ...e, ...over } : e));
	}

	function blank(cid: string, up?: Up): Row {
		return { s: 'm', id: '', cid, c: '', f: me!, t: '', gr: g.id, x: '', d: Date.now(), up };
	}

	/**
	 * The file goes into the thread first and moves second, so there is always something to
	 * look at while it uploads and something to retry when it does not.
	 */
	async function send_file(f: File, once: boolean, cid = crypto.randomUUID()) {
		const up: Up = { pct: 0, st: 'u', name: f.name, size: f.size, type: f.type, vo: once };
		if (!messages.some((e) => e.cid === cid)) {
			messages = [...messages, blank(cid, up)];
			files[cid] = f;
			scroll_down();
		} else patch(cid, { up, err: false });

		const h = upload(f, {
			view_once: once,
			onprogress: (pct) => patch(cid, { up: { ...up, pct } })
		});
		const r = await h.promise;
		if (r.error || !r.key) return patch(cid, { up: { ...up, st: 'e' } });

		patch(cid, { up: { ...up, pct: 100, st: 's' } });
		const image = f.type.startsWith('image/') ? r.key : undefined;
		const file = image ? undefined : { key: r.key, name: r.name!, size: r.size!, type: r.type! };
		const res = await fetch('/api/send', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ group: g.id, image, file, view_once: once, reply_to: replyTo?.id })
		}).catch(() => null);

		if (!res?.ok) return patch(cid, { up: { ...up, st: 'e' } });
		mark_first_send();
		replyTo = null;
		const { m } = await res.json();
		delete files[cid];
		patch(cid, { id: m.id, d: m.ts, up: undefined, im: image, fl: file, vo: m.vo, vk: m.vk });
	}

	async function send(retry?: Row) {
		if (retry?.cid) {
			const f = files[retry.cid];
			if (f) return send_file(f, !!retry.up?.vo || !!retry.vo, retry.cid);
		}
		const body = retry ? retry.x : text.trim();
		if ((!body && !pendingFiles.length && !retry) || busy) return;

		const once = view_once;
		const queued = pendingFiles;
		if (!retry) {
			pendingFiles = [];
			view_once = false;
		}
		for (const f of queued) send_file(f, once);
		if (!body) return;

		if (!retry) {
			text = '';
			if (composerInput) composerInput.style.height = 'auto';
		}

		let row: Row;
		if (retry) {
			retry.err = false;
			row = retry;
		} else {
			row = {
				...blank(crypto.randomUUID()),
				x: body,
				rp: replyTo?.id,
				...(once ? { vo: 1 as const, vk: 't' as const } : {})
			};
			messages = [...messages, row];
			scroll_down();
		}

		const res = await fetch('/api/send', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				group: g.id,
				text: body,
				view_once: once,
				reply_to: replyTo?.id
			})
		}).catch(() => null);

		if (!res?.ok) {
			if (row.cid) messages = mark_failed(messages, row.cid);
			return;
		}
		mark_first_send();
		replyTo = null;
		const { m } = await res.json();
		if (row.cid && m)
			messages = confirm_sent(messages, row.cid, { id: m.id, d: m.ts, rp: m.rp, fw: m.fw });
	}

	async function do_delete(m: Row, scope: 'me' | 'all') {
		const res = await fetch(`/api/messages/${m.id}/delete`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ scope })
		}).catch(() => null);
		if (!res?.ok) return;
		messages =
			scope === 'me'
				? messages.filter((e) => e.id !== m.id)
				: messages.map((e) => (e.id === m.id ? { ...e, dx: Date.now(), x: '' } : e));
	}

	function actions_for(m: Row): string[] {
		if (m.dx) return [];
		if (failed(m)) return ['retry', 'delete_me'];
		if (pending(m)) return [];
		const out: string[] = [];
		if (openable(m, me!)) out.push('open');
		out.push('reply');
		if (m.f !== me) out.push('private');
		out.push('react');
		if (!m.vo) out.push('forward');
		if (m.x) out.push('copy');
		out.push('delete_me');
		if (m.f === me || owner) out.push('delete_all');
		return out;
	}

	function on_action(id: string, m: Row) {
		if (id.startsWith('react_')) return react(m.id, id.slice(6));
		if (id === 'open') return (viewing = m);
		if (id === 'reply') return startReply(m);
		if (id === 'private') return void goto(`/chat/${m.f}?reply=${m.id}`);
		if (id === 'react') return (reactingTo = m.id);
		if (id === 'forward') return openForward(m);
		if (id === 'copy') return void navigator.clipboard?.writeText(m.x);
		if (id === 'retry') return void send(m);
		if (id === 'delete_me') return void do_delete(m, 'me');
		if (id === 'delete_all') return void do_delete(m, 'all');
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
		const el = e.currentTarget as HTMLInputElement;
		pendingFiles = [...pendingFiles, ...(el.files ?? [])];
		el.value = '';
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
				messages = messages.map((e) =>
					e.id === m.id ? { ...e, dx: Date.now(), x: '', im: undefined, fl: undefined } : e
				);
				return;
			}
			if (m.type === 'viewed') {
				messages = messages.map((e) =>
					e.id === m.id
						? { ...e, vw: [...(e.vw ?? []), m.by as string], ...(m.gone ? { vd: Date.now() } : {}) }
						: e
				);
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
			<MessageRow
				{m}
				me={me!}
				mine={own}
				sender_name={own ? undefined : (names[m.f] ?? 'someone')}
				quoted={m.rp ? quoted[m.rp] : null}
				quoted_name={m.rp
					? (names[quoted[m.rp]?.f ?? ''] ?? (quoted[m.rp]?.f === me ? 'you' : 'someone'))
					: undefined}
				actions={actions_for(m)}
				onaction={on_action}
			/>
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
		{#if pendingFiles.length}
			<div class="flex shrink-0 flex-wrap items-center gap-1.5 border-t border-line py-1.5">
				{#each pendingFiles as f, i (f.name + i)}
					<span
						class="flex items-center gap-1.5 rounded-full border border-line bg-panel-solid px-2 py-0.5 text-[11.5px] text-ink-soft"
					>
						{f.name}
						<button
							type="button"
							class="text-mute hover:text-danger"
							aria-label="remove {f.name}"
							onclick={() => (pendingFiles = pendingFiles.filter((_, j) => j !== i))}
							>&times;</button
						>
					</span>
				{/each}
				{#if view_once}
					<span class="text-[11px] uppercase tracking-[0.14em] text-accent">view once</span>
				{/if}
			</div>
		{/if}
		<form
			class="flex shrink-0 items-end gap-1.5 border-t border-line py-2.5"
			use:ctrlEnter={() => send()}
			onsubmit={(e) => (e.preventDefault(), send())}
			ondragover={(e) => e.preventDefault()}
			ondrop={(e) => {
				const f = [...(e.dataTransfer?.files ?? [])];
				if (f.length) {
					e.preventDefault();
					pendingFiles = [...pendingFiles, ...f];
				}
			}}
		>
			<label
				class="btn btn-icon cursor-pointer {pendingFiles.length ? 'border-accent text-accent' : ''}"
				aria-label="attach file"
				title={pendingFiles.length ? pendingFiles.map((f) => f.name).join(', ') : 'attach file'}
			>
				<Image size={15} />
				<input type="file" multiple class="hidden" onchange={onpick} />
			</label>
			<button
				type="button"
				class="btn btn-icon {view_once ? 'border-accent text-accent' : ''}"
				aria-label="view once"
				title={view_once ? 'view once is on for the next send' : 'send the next one as view once'}
				aria-pressed={view_once}
				onclick={() => (view_once = !view_once)}
			>
				<Eye size={15} />
			</button>
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
				class="max-h-[132px] min-w-0 flex-1 resize-none overflow-y-hidden py-2 leading-[1.4]"
				rows="1"
				bind:this={composerInput}
				bind:value={text}
				oninput={grow}
				placeholder="say something to the room…"
				autocomplete="off"
				onpaste={(e) => {
					const f = image_from_event(e);
					if (f) pendingFiles = [...pendingFiles, f];
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

{#if viewing}
	<MediaViewer
		m={viewing}
		me={me!}
		onburnt={(id) =>
			(messages = messages.map((e) => (e.id === id ? { ...e, vw: [...(e.vw ?? []), me!] } : e)))}
		onclose={() => (viewing = null)}
	/>
{/if}

<style>
	input[type='file'] {
		display: none;
	}
</style>
