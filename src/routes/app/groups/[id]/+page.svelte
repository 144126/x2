<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { onMount, onDestroy } from 'svelte';
	import { ws_on } from '$lib/ws';
	import { upload_image, media_src, image_from_event } from '$lib/attach';
	import { mark_first_send } from '$lib/notify-trigger';
	import type { Message } from '$lib/types';
	import { ArrowLeft, Image, Send as SendIcon } from '@lucide/svelte';

	let { data } = $props();
	let g = $state(data.g);
	let messages = $state(data.messages as Message[]);
	let names = $state<Record<string, string>>(data.names);
	let text = $state('');
	let pending: File | null = $state(null);
	let busy = $state(false);
	let unsub: (() => void) | null = null;

	let me = $derived($page.data.user?.id);
	let mine = $derived(!!me && g.members.includes(me));
	let owner = $derived(!!me && g.owner === me);

	// owner-only edit panel
	let editing = $state(false);
	let ename = $state(g.name);
	let edesc = $state(g.description);

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
			messages = [...messages, { s: 'm', id: m.id, c: '', f: m.from, t: '', gr: g.id, x: m.text, im: m.image, d: m.ts }];
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
		if (res.ok) goto('/app/groups');
	}

	function onpick(e: Event) {
		const f = (e.currentTarget as HTMLInputElement).files?.[0];
		if (f) pending = f;
	}

	onMount(() => {
		unsub = ws_on((m) => {
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
	onDestroy(() => unsub?.());
</script>

<section class="mx-auto flex h-[calc(100dvh-140px)] max-w-[760px] flex-col sm:h-[calc(100dvh-110px)]">
	<header class="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line py-4">
		<button
			class="bg-none leading-none text-ink-soft transition-colors duration-300 hover:text-accent"
			onclick={() => goto('/app/groups')}
			aria-label="back"
		>
			<ArrowLeft size={22} />
		</button>
		<div class="flex min-w-0 flex-col gap-0.5">
			<h1 class="truncate font-display text-[21px] font-medium tracking-[-0.01em]">{g.name}</h1>
			<span class="text-[10.5px] uppercase tracking-[0.2em] text-faint"
				>{g.members.length} member{g.members.length === 1 ? '' : 's'}</span
			>
		</div>
		<div class="ml-auto flex items-center gap-2">
			{#if owner}
				<button class="btn px-4 py-2 text-[12px]" onclick={() => (editing = !editing)}>{editing ? 'close' : 'edit'}</button>
			{:else if mine}
				<button class="btn px-4 py-2 text-[12px]" onclick={() => membership('leave')}>leave</button>
			{:else}
				<button class="btn btn-amber px-4 py-2 text-[12px]" onclick={() => membership('join')}>join</button>
			{/if}
		</div>
	</header>

	{#if editing}
		<form class="flex flex-col gap-2 border-b border-line py-4" onsubmit={(e) => (e.preventDefault(), save_edits())}>
			<input bind:value={ename} placeholder="room name" maxlength="60" />
			<textarea bind:value={edesc} rows="2" placeholder="what this room is about (used for search)"></textarea>
			<div class="flex gap-2">
				<button class="btn btn-amber px-4 py-2 text-[12px]" type="submit">save</button>
				<button class="btn px-4 py-2 text-[12px] text-red-400" type="button" onclick={remove}>delete room</button>
			</div>
		</form>
	{:else if g.description}
		<p class="border-b border-line py-3 text-[13.5px] leading-[1.5] text-ink-soft">{g.description}</p>
	{/if}

	<div bind:this={thread} class="flex flex-1 flex-col gap-3 overflow-y-auto py-6">
		{#each messages as m (m.id)}
			<div class="flex max-w-[85%] flex-col gap-1 sm:max-w-[70%] {m.f === me ? 'self-end items-end' : 'self-start'}">
				{#if m.f !== me}
					<a href="/app/user/{m.f}" class="text-[11px] uppercase tracking-[0.16em] text-mute hover:text-accent"
						>{names[m.f] ?? 'someone'}</a
					>
				{/if}
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
			<label class="btn shrink-0 cursor-pointer px-3 py-3" aria-label="attach image" title={pending ? pending.name : 'attach image'}>
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
			<button class="btn btn-amber shrink-0 flex items-center gap-1.5 !px-4" type="submit" disabled={busy}>
				<SendIcon size={16} /> {busy ? 'sending' : 'send'}
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
