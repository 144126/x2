<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { dev } from '$app/environment';
	import { ws_on, ws_send } from '$lib/ws';
	import { CallMesh, media_error, type CallSignal } from '$lib/call';
	import { enable_push, push_available } from '$lib/push-client';
	import { questions_for } from '$lib/prompts';
	import CallOverlay from '$lib/components/CallOverlay.svelte';
	import { Mic, LoaderCircle, MessageSquare, Users, BellRing, Check } from '@lucide/svelte';

	let { data } = $props();

	type Peer = { id: string; name: string; shared: string[]; conv: string };

	let phase = $state<'idle' | 'searching' | 'call' | 'ended'>('idle');
	let waiting = $state(0);
	let peer = $state<Peer | null>(null);
	let err = $state('');
	let micOn = $state(true);
	let localStream = $state<MediaStream | null>(null);
	let remoteStream = $state<MediaStream | null>(null);
	let me = $state('');
	let blurb = $state('');
	let parked = $state(false);
	let parking = $state(false);
	let park_err = $state('');

	let lobby: WebSocket | null = null;
	let mesh: CallMesh | null = null;
	let unsub: (() => void) | null = null;

	let call_peers = $derived(peer ? [{ uid: peer.id, name: peer.name, stream: remoteStream }] : []);

	function signals() {
		unsub ??= ws_on((m) => {
			if (m.type === 'ws_down') return drop_call();
			if (m.type !== 'signal' || m.ctx !== 'dm' || !peer || m.from !== peer.id) return;
			mesh?.handle(m.from as string, m.signal as CallSignal);
		});
	}

	function make_mesh(): CallMesh {
		return new CallMesh({
			me,
			send: (to, signal) => ws_send({ type: 'signal', to, signal, ctx: 'dm' }),
			onremote: (uid, stream) => {
				if (!peer || uid !== peer.id) return;
				if (!stream) return next();
				remoteStream = stream;
			},
			fetchTurn: async () => {
				const r = await fetch('/api/turn', { method: 'POST' }).catch(() => null);
				if (!r?.ok) return [];
				const { iceServers } = (await r.json()) as { iceServers: RTCIceServer | RTCIceServer[] };
				return Array.isArray(iceServers) ? iceServers : [iceServers];
			}
		});
	}

	async function start() {
		err = '';
		phase = 'searching';
		const r = await fetch('/api/wstoken', { method: 'POST' }).catch(() => null);
		if (!r?.ok) {
			err = 'could not reach the matching service — try again.';
			phase = 'idle';
			return;
		}
		const j = (await r.json()) as { uid: string; match: string };
		me = j.uid;
		if (!data.user) invalidateAll();
		signals();
		lobby = new WebSocket(j.match);
		lobby.onmessage = (ev) => {
			const m = JSON.parse(ev.data) as {
				type: string;
				n?: number;
				peer?: string;
				peer_name?: string;
				shared?: string[];
				conv?: string;
			};
			if (m.type === 'searching' || m.type === 'waiting') waiting = m.n ?? 0;
			else if (m.type === 'parked') parked = true;
			else if (m.type === 'matched') {
				peer = {
					id: m.peer!,
					name: m.peer_name ?? 'someone',
					shared: m.shared ?? [],
					conv: m.conv ?? ''
				};
				open_call();
				explain(m.peer!);
			}
		};
		lobby.onclose = () => {
			lobby = null;
			if (phase === 'searching') {
				err = 'the matching service dropped — try again.';
				phase = 'idle';
			}
		};
		lobby.onerror = () => lobby?.close();
	}

	// why these two, in a written line rather than a set intersection. Deliberately not
	// awaited: the call is already connecting, and a slow or rate-limited model must never
	// hold it up — the shared-interest line shows until this lands, if it lands.
	async function explain(uid: string) {
		blurb = '';
		const r = await fetch(`/api/match/blurb?peer=${encodeURIComponent(uid)}`).catch(() => null);
		if (!r?.ok) return;
		const { t } = (await r.json()) as { t: string };
		if (t && peer?.id === uid) blurb = t;
	}

	/** leave the queue open, but ask to be woken by a notification instead of waiting here */
	async function park() {
		park_err = '';
		const avail = push_available();
		if (!avail.ok) {
			park_err =
				avail.reason === 'ios-needs-install'
					? 'add x2 to your home screen first, then notifications work.'
					: 'this browser cannot send notifications.';
			return;
		}
		parking = true;
		try {
			// the service worker is only registered for signed-in visitors on mount, and
			// serviceWorker.ready never resolves without a registration
			if (!(await navigator.serviceWorker.getRegistration()))
				await navigator.serviceWorker.register('/service-worker.js', {
					type: dev ? 'module' : 'classic'
				});
			const res = await fetch('/api/push');
			const { key } = (await res.json()) as { key: string };
			const ok = await enable_push(key);
			if (!ok.ok) {
				park_err = 'notifications are blocked — turn them on in your browser settings.';
				return;
			}
			lobby?.send(
				JSON.stringify({
					type: 'park',
					tz: Intl.DateTimeFormat().resolvedOptions().timeZone
				})
			);
		} catch {
			park_err = 'could not set that up — try again.';
		} finally {
			parking = false;
		}
	}

	async function open_call() {
		mesh = make_mesh();
		try {
			// voice only: the whole point is that you talk before you look
			localStream = await mesh.open(false);
		} catch (e) {
			err = media_error(e);
			mesh = null;
			peer = null;
			phase = 'idle';
			lobby?.close();
			return;
		}
		micOn = true;
		phase = 'call';
		mesh.announce([peer!.id]);
	}

	function drop_call() {
		mesh?.hangup(true);
		mesh = null;
		localStream = null;
		remoteStream = null;
	}

	/** hang up on this person and go straight back into the queue */
	function next() {
		const skip = peer?.id;
		drop_call();
		peer = null;
		remoteStream = null;
		phase = 'searching';
		lobby?.send(JSON.stringify({ type: 'again', skip }));
	}

	function stop() {
		drop_call();
		lobby?.send(JSON.stringify({ type: 'stop' }));
		lobby?.close();
		lobby = null;
		phase = peer ? 'ended' : 'idle';
	}

	function toggleMic() {
		micOn = !micOn;
		mesh?.setMic(micOn);
	}

	/** leaving because of harm: record it, then get them out immediately */
	function report() {
		const body = JSON.stringify({ peer: peer?.id, conv: peer?.conv });
		fetch('/api/report', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body
		}).catch(() => {});
		next();
	}

	onMount(() => {
		// arriving from the "someone wants to talk" notification: start searching straight
		// away. Landing on a button would waste the one moment they came back for.
		if (new URLSearchParams(location.search).get('talk')) start();
	});

	onDestroy(() => {
		drop_call();
		lobby?.close();
		unsub?.();
	});
</script>

<svelte:head>
	<title>x2 — talk to someone who gets it</title>
	<meta
		name="description"
		content="press one button and you are talking to a stranger picked by what you are into, not by luck. voice only, no profile to perform for."
	/>
</svelte:head>

<section class="flex h-full flex-col items-center justify-center py-6 text-center">
	{#if phase === 'searching'}
		<div class="reveal flex flex-col items-center gap-5">
			<span class="relative flex h-20 w-20 items-center justify-center">
				<span class="absolute inset-0 animate-ping rounded-full bg-accent/20"></span>
				<span
					class="flex h-20 w-20 items-center justify-center rounded-full border border-accent/40"
					><LoaderCircle size={24} class="animate-spin text-accent" /></span
				>
			</span>
			<h1 class="h1">finding someone…</h1>
			<p class="text-[13px] text-mute">
				{waiting > 1
					? `${waiting} people looking right now`
					: 'you are first in the queue — hang on'}
			</p>
			{#if parked}
				<p class="flex items-center gap-1.5 text-[12.5px] text-accent">
					<Check size={13} /> we'll ping you when someone's around — you can close this.
				</p>
			{:else}
				<button class="btn" onclick={park} disabled={parking}>
					<BellRing size={13} />
					{parking ? 'setting up…' : "notify me instead, i'll leave"}
				</button>
			{/if}
			{#if park_err}<p class="max-w-[320px] text-[12px] text-danger">{park_err}</p>{/if}
			<button class="btn btn-ghost text-mute" onclick={stop}>cancel</button>
		</div>
	{:else}
		<div class="reveal flex max-w-[520px] flex-col items-center gap-5">
			<div class="eyebrow">x2 · voice roulette</div>
			<h1 class="display text-[clamp(30px,6vw,54px)]">
				talk to someone<br /><em class="italic text-accent">who gets it</em>.
			</h1>
			<p class="text-[14px] leading-[1.6] text-ink-soft">
				one button, one stranger, voice only. we pick by what you are into, not by luck — so the
				first thirty seconds are not small talk.
			</p>
			{#if phase === 'ended' && peer}
				<div class="card flex w-full items-center gap-3 text-left">
					<div class="min-w-0 flex-1">
						<p class="text-[13px] text-ink">you talked to {peer.name}</p>
						<p class="text-[11.5px] text-mute">keep it going in a thread?</p>
					</div>
					<a class="btn shrink-0" href="/app/chat/{peer.id}"><MessageSquare size={13} /> message</a>
				</div>
			{/if}
			<button class="btn btn-amber px-6 py-3 text-[14px]" onclick={start}>
				<Mic size={16} />
				{phase === 'ended' ? 'talk to someone else' : 'start talking'}
			</button>
			{#if err}<p class="text-[12px] text-danger">{err}</p>{/if}
			<p class="text-[11.5px] text-mute">
				no signup — you get an account the moment you press it, and you can link a real one later.
			</p>
		</div>

		{#if data.rooms.length}
			<div class="mt-10 w-full max-w-[620px]">
				<div class="eyebrow mb-3">or drop into a room instead</div>
				<ul class="grid gap-2 sm:grid-cols-2">
					{#each data.rooms.slice(0, 4) as g, i (g.id)}
						<li class="card reveal text-left" style="--i:{i}">
							<a
								href="/app/rooms/{g.id}"
								class="font-display text-[15px] font-medium hover:text-accent">{g.name}</a
							>
							<p class="mt-1 line-clamp-1 text-[12px] text-ink-soft">{g.description}</p>
							<span class="mt-1.5 flex items-center gap-1 text-[11px] text-mute">
								<Users size={11} />
								{g.members.length}
							</span>
						</li>
					{/each}
				</ul>
			</div>
		{/if}
	{/if}
</section>

{#if phase === 'call' && peer}
	<CallOverlay
		phase="connected"
		title={peer.name}
		subtitle={blurb || (peer.shared.length ? `you both like ${peer.shared.join(', ')}` : '')}
		peers={call_peers}
		local={localStream}
		{micOn}
		canVideo={false}
		nextLabel="next person"
		questions={questions_for(peer.conv || peer.id)}
		error={err}
		onhangup={stop}
		ontogglemic={toggleMic}
		onnext={next}
		onreport={report}
	/>
{/if}
