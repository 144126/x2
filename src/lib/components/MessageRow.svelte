<script lang="ts">
	import {
		CornerUpLeft,
		SmilePlus,
		Forward,
		Copy,
		MessageSquare,
		RotateCw,
		Eye,
		EyeOff,
		Trash2
	} from '@lucide/svelte';
	import Attachment from './Attachment.svelte';
	import MessageMenu from './MessageMenu.svelte';
	import { sticker_src } from '$lib/stickers';
	import { clock } from '$lib/time';
	import { failed, pending, has_attachment, openable, burnt, type Item, type Row } from '$lib/msg';

	let {
		m,
		me,
		mine,
		sender_name,
		quoted,
		quoted_name,
		actions,
		onaction
	}: {
		m: Row;
		me: string;
		mine: boolean;
		sender_name?: string;
		quoted?: Row | null;
		quoted_name?: string;
		actions: string[];
		onaction: (id: string, m: Row) => void;
	} = $props();

	const LABELS: Record<string, { label: string; icon: Item['icon']; danger?: boolean }> = {
		open: { label: 'open', icon: Eye },
		reply: { label: 'reply', icon: CornerUpLeft },
		react: { label: 'react', icon: SmilePlus },
		forward: { label: 'forward', icon: Forward },
		copy: { label: 'copy text', icon: Copy },
		private: { label: 'reply privately', icon: MessageSquare },
		retry: { label: 'try again', icon: RotateCw },
		delete_me: { label: 'delete for me', icon: Trash2, danger: true },
		delete_all: { label: 'delete for everyone', icon: Trash2, danger: true }
	};

	const BUBBLE_MINE = 'rounded-[14px_4px_14px_14px] border border-accent bg-accent text-accent-ink';
	const BUBBLE_THEIRS = 'rounded-[4px_14px_14px_14px] border border-line bg-panel-solid';

	let rect = $state<DOMRect | null>(null);
	let spent = $derived(burnt(m, me));

	let items = $derived(
		actions.filter((id) => LABELS[id]).map((id) => ({ id, ...LABELS[id] }) as Item)
	);

	function open_menu(e: MouseEvent) {
		// a drag to select text must not also pop a menu over the words being selected
		if (!getSelection()?.isCollapsed) return;
		if (!items.length) return;
		rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
	}
</script>

<div
	class="relative flex max-w-[80%] flex-col gap-0.5 sm:max-w-[68%] {mine
		? 'items-end self-end'
		: 'self-start'}"
>
	{#if !mine && sender_name}
		<span class="px-1 text-[10px] uppercase tracking-[0.14em] text-mute">{sender_name}</span>
	{/if}

	{#if m.dx}
		<div
			class="rounded-[14px] border border-line px-3 py-2 text-[13px] italic text-mute {mine
				? 'self-end'
				: ''}"
		>
			this message was deleted
		</div>
	{:else}
		<button
			type="button"
			class="w-full cursor-default overflow-hidden px-3 py-2 text-left text-[13.5px] leading-[1.45] {mine
				? BUBBLE_MINE
				: BUBBLE_THEIRS} {m.sk ? 'border-0 bg-transparent p-0' : ''} {pending(m) || failed(m)
				? 'opacity-60'
				: ''}"
			onclick={open_menu}
		>
			{#if m.fw}
				<div class="mb-1 text-[9.5px] uppercase tracking-[0.12em] opacity-60">forwarded</div>
			{/if}

			{#if m.sk && !m.vo}
				<img
					src={sticker_src(m.sk)}
					alt="{m.sk} sticker"
					class="h-[104px] w-[104px] object-contain"
				/>
			{:else}
				{#if m.rp}
					<div class="mb-1.5 truncate border-l-2 border-current/40 pl-2 text-[11.5px] opacity-70">
						<span class="font-medium">{quoted_name ?? 'someone'}</span>
						<span class="opacity-80"> · {quoted?.x || 'original message'}</span>
					</div>
				{/if}

				{#if has_attachment(m)}
					<div class="mb-1.5">
						<Attachment {m} {me} onopen={() => onaction('open', m)} />
					</div>
				{/if}

				{#if m.x}<span class="whitespace-pre-wrap break-words">{m.x}</span>{/if}
			{/if}
		</button>
	{/if}

	{#if m.rx && Object.keys(m.rx).length}
		<div class="-mt-1 flex flex-wrap gap-1">
			{#each Object.entries(m.rx).slice(0, 4) as [emoji, uids] (emoji)}
				<button
					type="button"
					class="flex items-center gap-1 rounded-full border border-line bg-panel-solid px-1.5 py-0.5 text-[11px]"
					class:border-accent={uids.includes(me)}
					onclick={() => onaction('react_' + emoji, m)}
				>
					{emoji}
					{uids.length}
				</button>
			{/each}
		</div>
	{/if}

	<div class="flex items-center gap-1.5 px-1">
		{#if failed(m)}
			<button class="text-[10.5px] text-danger underline" onclick={() => onaction('retry', m)}>
				not sent — try again
			</button>
		{:else}
			<time class="text-[9.5px] tabular-nums text-mute">{clock(m.d)}</time>
			{#if m.vo && !m.dx}
				<span class="flex items-center gap-1 text-[9.5px] text-mute">
					{#if spent}<EyeOff size={9} />{mine ? 'opened' : 'gone'}{:else}<Eye size={9} />{openable(
							m,
							me
						)
							? 'once'
							: 'sent'}{/if}
				</span>
			{/if}
		{/if}
	</div>

	{#if rect}
		<MessageMenu {rect} {items} onpick={(id) => onaction(id, m)} onclose={() => (rect = null)} />
	{/if}
</div>
