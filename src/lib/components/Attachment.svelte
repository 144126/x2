<script lang="ts">
	import { FileText, Image, Mic, EyeOff, Eye, Sticker } from '@lucide/svelte';
	import { label, size_of, pending, failed, burnt, openable, type Row } from '$lib/msg';
	import { msg_kind } from '$lib/types';

	let { m, me, onopen }: { m: Row; me: string; onopen: () => void } = $props();

	const CHIP =
		'flex w-full min-w-0 items-center gap-2 rounded-[8px] border border-current/20 px-2.5 py-1.5 text-left text-[12px]';

	let kind = $derived(m.vk ?? (m.up ? guess(m.up.type) : msg_kind(m)));
	let spent = $derived(burnt(m, me));
	let live = $derived(pending(m));
	let broke = $derived(failed(m));
	let can_open = $derived(openable(m, me));

	function guess(type: string) {
		if (type.startsWith('image/')) return 'i';
		if (type.startsWith('audio/')) return 'a';
		return 'f';
	}

	const ICON = { i: Image, a: Mic, f: FileText, s: Sticker, t: FileText } as const;
</script>

<svelte:element
	this={can_open ? 'button' : 'div'}
	type={can_open ? 'button' : undefined}
	class="{CHIP} {live || broke || spent ? 'opacity-60' : ''} {can_open
		? 'hover:border-current/50'
		: ''}"
	onclick={can_open ? onopen : undefined}
>
	{#if m.vo}
		{#if spent}<EyeOff size={14} class="shrink-0" />{:else}<Eye size={14} class="shrink-0" />{/if}
	{:else}
		{@const Icon = ICON[kind]}
		<Icon size={14} class="shrink-0" />
	{/if}

	<span class="min-w-0 flex-1 truncate">{label(m, me)}</span>

	{#if live}
		<span class="shrink-0 tabular-nums opacity-70"
			>{m.up?.st === 's' ? 'sending' : `${m.up?.pct}%`}</span
		>
	{:else if broke}
		<span class="shrink-0 text-danger">not sent</span>
	{:else if size_of(m)}
		<span class="shrink-0 opacity-60">{size_of(m)}</span>
	{/if}
</svelte:element>

{#if live}
	<div class="mt-1 h-px w-full overflow-hidden bg-current/15">
		<!-- the one bound style in the app: a percentage cannot be a utility class -->
		<div
			class="h-full bg-current/60 transition-[width] duration-200"
			style:width="{m.up?.pct ?? 0}%"
		></div>
	</div>
{/if}
