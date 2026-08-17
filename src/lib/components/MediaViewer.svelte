<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { X, Download } from '@lucide/svelte';
	import { media_src } from '$lib/attach';
	import { unb64u } from '$lib/b64';
	import { label, type Row } from '$lib/msg';
	import { KIND_LABEL, msg_kind, type MsgKind } from '$lib/types';

	let {
		m,
		me,
		onburnt,
		onclose
	}: { m: Row; me: string; onburnt: (id: string) => void; onclose: () => void } = $props();

	let src = $state('');
	let kind = $state<MsgKind>(m.vk ?? msg_kind(m));
	let name = $state(m.fl?.name ?? '');
	let caption = $state(m.x ?? '');
	let text = $state('');
	let err = $state('');
	let loading = $state(true);
	let blob_url = '';

	const decode = (v: string | null) => (v ? new TextDecoder().decode(unb64u(v)) : '');

	onMount(async () => {
		if (!m.vo) {
			const key = m.im ?? m.fl?.key;
			src = key ? media_src(key) : '';
			loading = false;
			return;
		}
		await spend();
	});

	// The view is spent by this call and the content comes back with it. There is no url to
	// fetch afterwards, so the blob below is the only copy that ever exists in this tab.
	async function spend() {
		const res = await fetch(`/api/messages/${m.id}/view`, { method: 'POST' }).catch(() => null);
		loading = false;
		if (!res) return (err = 'could not open it — check your connection.');
		if (res.status === 410) return (err = 'this one is gone. it could only be opened once.');
		if (res.status === 403) return (err = 'you cannot reopen something you sent.');
		if (!res.ok) return (err = 'could not open it.');

		onburnt(m.id);
		const ct = res.headers.get('content-type') ?? '';
		if (ct.includes('application/json')) {
			const b = (await res.json()) as { kind: MsgKind; text?: string; sticker?: string };
			kind = b.kind;
			text = b.text ?? '';
			return;
		}
		kind = (res.headers.get('x-kind') as MsgKind) ?? kind;
		name = decode(res.headers.get('x-name')) || name;
		caption = decode(res.headers.get('x-caption'));
		blob_url = URL.createObjectURL(await res.blob());
		src = blob_url;
	}

	onDestroy(() => {
		if (blob_url) URL.revokeObjectURL(blob_url);
	});

	const block = (e: Event) => m.vo && e.preventDefault();
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onclose()} />

<div
	class="fixed inset-0 z-50 flex flex-col bg-base/95 backdrop-blur-sm"
	role="dialog"
	aria-modal="true"
	aria-label={label(m, me)}
>
	<div class="flex shrink-0 items-center gap-3 border-b border-line px-4 py-2.5">
		<span class="min-w-0 flex-1 truncate text-[13px] text-ink-soft">
			{m.vo ? `view once ${KIND_LABEL[kind]}` : name || KIND_LABEL[kind]}
		</span>
		{#if src && !m.vo}
			<a class="btn btn-icon" href={src} download={name} aria-label="download"
				><Download size={15} /></a
			>
		{/if}
		<button class="btn btn-icon" onclick={onclose} aria-label="close"><X size={15} /></button>
	</div>

	<div class="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4">
		{#if loading}
			<p class="text-[13px] text-mute">opening…</p>
		{:else if err}
			<p class="max-w-[320px] text-center text-[13px] text-danger">{err}</p>
		{:else if kind === 'i' && src}
			<img
				{src}
				alt=""
				draggable="false"
				oncontextmenu={block}
				class="max-h-full max-w-full object-contain"
			/>
		{:else if kind === 'a' && src}
			<audio controls autoplay {src} oncontextmenu={block} class="w-full max-w-[420px]"></audio>
		{:else if kind === 't' || kind === 's'}
			<p class="max-w-[520px] whitespace-pre-wrap break-words text-[15px] leading-[1.6] text-ink">
				{text || caption || '(empty)'}
			</p>
		{:else if src}
			<div class="flex flex-col items-center gap-3">
				<p class="text-[13px] text-ink-soft">{name || 'file'}</p>
				{#if m.vo}
					<a class="btn btn-amber" href={src} download={name}>save it now — it is not kept</a>
				{:else}
					<a class="btn btn-amber" href={src} download={name}>download</a>
				{/if}
			</div>
		{/if}
	</div>

	{#if caption && kind !== 't' && kind !== 's'}
		<p class="shrink-0 border-t border-line px-4 py-2.5 text-[13.5px] text-ink-soft">{caption}</p>
	{/if}

	{#if m.vo && !err && !loading}
		<p class="shrink-0 px-4 pb-3 text-center text-[11.5px] text-mute">
			once you close this, it is gone.
		</p>
	{/if}
</div>
