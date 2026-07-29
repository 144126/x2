<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { onMount, onDestroy } from 'svelte';
	import { ws_on, ws_send } from '$lib/ws';
	import { upload_image, media_src, image_from_event } from '$lib/attach';
	import { mark_first_send } from '$lib/notify-trigger';
	import type { Message } from '$lib/types';
	import { CallMesh, type CallSignal } from '$lib/call';
	import RemoteVideo from '$lib/components/RemoteVideo.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import MuteButton from '$lib/components/MuteButton.svelte';
	import {
		ArrowLeft,
		Image,
		Send as SendIcon,
		Phone,
		PhoneOff,
		Mic,
		MicOff,
		Video,
		VideoOff
	} from '@lucide/svelte';

	let { data } = $props();
	let g = $state(data.g);
	let messages = $state(data.messages as Message[]);
	let names = $state<Record<string, string>>(data.names);
	let muted = $state(data.muted as boolean);
	let text = $state('');
	let pending: File | null = $state(null);
	let busy = $state(false);
	let unsub: (() => void) | null = null;

	let me = $derived($page.data.user?.id);
	let mine = $derived(!!me && g.members.includes(me));
	let owner = $derived(!!me && g.owner === me);

	// owner-only edit panel
	let aboutOpen = $state(false);
	let editing = $state(false);
	let ename = $state(g.name);
	let edesc = $state(g.description);

	// ponytail: full mesh — every participant connects to every other. Comfortable to ~4-6
	// people; an SFU is the upgrade path if rooms need to be bigger.
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
			// `ctx` scopes signals to this room — without it a DM call's offer/ice to
			// this uid would be handled here too (and vice versa), and this mesh
			// auto-answers, so a signal meant for a different context would silently
			// join a stranger's call to this room
			send: (to, signal) => ws_send({ type: 'signal', to, signal, ctx: `room:${g.id}` }),
			onremote: (uid, stream) => {
				remotes = stream
					? [...remotes.filter((r) => r.uid !== uid), { uid, stream }]
					: remotes.filter((r) => r.uid !== uid);
			}
			// no onincoming: room calls auto-answer once you've joined
		});
	}

	async function joinCall() {
		callError = '';
		mesh ??= makeMesh();
		try {
			localStream = await mesh.open(videoOn);
			inCall = true;
			mesh.announce(g.members);
		} catch (e) {
			console.error('[ROOM-CLIENT] joinCall failed', e);
			callError = 'could not access camera/mic — check permissions.';
			mesh = null;
		}
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
		videoOn = !videoOn;
		await mesh?.setVideo(videoOn);
	}

	let thread: HTMLDivElement | undefined = $state();
	function scroll_down() {
		requestAnimationFrame(() => thread?.scrollTo({ top: thread.scrollHeight }));
	}

	async function send() {
		const body = text.trim();
		if ((!body && !pending) || busy) return;
		busy = true;
		let image: string | undefined;
		if (pending) {
			const r = await upload_image(pending);
			if (r.error) {
				busy = false;
				return;
			}
			image = r.key;
			pending = null;
		}
		text = '';
		const res = await fetch('/api/send', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ group: g.id, text: body, image })
		});
		busy = false;
		if (res.ok) {
			mark_first_send();
			const { m } = await res.json();
			messages = [
				...messages,
				{ s: 'm', id: m.id, c: '', f: m.from, t: '', gr: g.id, x: m.text, im: m.image, d: m.ts }
			];
			scroll_down();
		}
	}

	async function membership(action: 'join' | 'leave') {
		const res = await fetch(`/api/groups/${g.id}`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ action })
		});
		if (res.ok) g = (await res.json()).g;
	}

	async function save_edits() {
		const res = await fetch(`/api/groups/${g.id}`, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ name: ename, description: edesc })
		});
		if (res.ok) {
			g = (await res.json()).g;
			editing = false;
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

	onMount(() => {
		unsub = ws_on((m) => {
			if (m.type === 'ws_down') return leaveCall(true);
			if (m.type === 'signal') {
				// room calls auto-answer, so without these checks any authenticated user
				// could address a signal at a room member and get auto-connected into a
				// call they were never invited to — both checks are load-bearing, not
				// belt-and-suspenders
				if (m.ctx !== `room:${g.id}`) return;
				if (!g.members.includes(m.from as string)) return;
				// a `join` from someone else is ignored by the mesh until we've joined too
				mesh ??= makeMesh();
				mesh.handle(m.from as string, m.signal as CallSignal);
				return;
			}
			if (m.type !== 'msg' || m.group !== g.id) return;
			names = { ...names, [m.from as string]: (m.from_name as string) ?? (m.from as string) };
			messages = [
				...messages,
				{
					s: 'm',
					id: (m.id as string) ?? String(m.ts),
					c: '',
					f: m.from as string,
					t: '',
					gr: g.id,
					x: (m.text as string) ?? '',
					im: m.image as string | undefined,
					d: m.ts as number
				}
			];
			scroll_down();
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
					onclick={joinCall}
				>
					<Phone size={14} /> join call
				</button>
			{/if}
			{#if mine}
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
				<button class="btn px-4 py-2 text-[12px]" onclick={() => (editing = !editing)}
					>{editing ? 'close' : 'edit'}</button
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

	{#if editing}
		<form
			class="flex flex-col gap-2 border-b border-line py-4"
			onsubmit={(e) => (e.preventDefault(), save_edits())}
		>
			<input bind:value={ename} placeholder="room name" maxlength="60" />
			<textarea bind:value={edesc} rows="2" placeholder="what this room is about (used for search)"
			></textarea>
			<div class="flex gap-2">
				<button class="btn btn-amber px-4 py-2 text-[12px]" type="submit">save</button>
				<button class="btn px-4 py-2 text-[12px] text-red-400" type="button" onclick={remove}
					>delete room</button
				>
			</div>
		</form>
	{/if}

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
		</div>
	</Modal>

	<div bind:this={thread} class="flex flex-1 flex-col gap-3 overflow-y-auto py-6">
		{#each messages as m (m.id)}
			<div
				class="flex max-w-[85%] flex-col gap-1 sm:max-w-[70%] {m.f === me
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
				>
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
				</div>
			</div>
		{/each}
		{#if !messages.length}
			<p class="text-[14.5px] text-faint">nothing here yet. say the first thing.</p>
		{/if}
	</div>

	{#if mine}
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
			<input
				class="min-w-0 flex-1 text-[15px]"
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
