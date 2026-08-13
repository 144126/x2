<script lang="ts">
	import Modal from './Modal.svelte';
	import { Sparkles, Send as SendIcon, LoaderCircle, Brain, ChevronDown } from '@lucide/svelte';
	import { Chat } from '@ai-sdk/svelte';
	import { DefaultChatTransport } from 'ai';
	import type { UIMessage } from 'ai';

	let {
		conv,
		peerName = ''
	}: {
		conv: string;
		peerName?: string;
	} = $props();

	let open = $state(false);
	let question = $state('');
	let balance = $state<number | null>(null);
	let koboPerSec = $state(0);
	let costKobo = $state<number | null>(null);
	let truncated = $state(false);
	let done = $state(false);
	let countdownInterval: ReturnType<typeof setInterval> | null = null;
	let showReason = $state<Record<string, boolean>>({});

	const chat = new Chat({
		transport: new DefaultChatTransport({
			api: '/api/ai/thread',
			prepareSendMessagesRequest: ({ messages }) => {
				const last = [...messages].reverse().find((m) => m.role === 'user');
				const question =
					last?.parts
						.filter((p) => p.type === 'text')
						.map((p) => p.text)
						.join('') ?? '';
				return { body: { conv, question } };
			}
		}),
		onData: (dataPart) => {
			if (dataPart.type !== 'data-billing') return;
			const d = dataPart.data as {
				balance?: number;
				max_seconds?: number;
				kobo_per_sec?: number;
				cost_kobo?: number;
				truncated?: boolean;
			};
			if (d.kobo_per_sec !== undefined) {
				koboPerSec = d.kobo_per_sec;
				balance = d.balance ?? null;
				if (koboPerSec > 0 && !countdownInterval) {
					countdownInterval = setInterval(() => {
						if (balance !== null && balance > 0) {
							balance = Math.max(0, balance - Math.round(koboPerSec));
						}
					}, 1000);
				}
			} else if (d.cost_kobo !== undefined) {
				balance = d.balance ?? null;
				costKobo = d.cost_kobo;
				truncated = d.truncated ?? false;
				done = true;
				if (countdownInterval) clearInterval(countdownInterval);
				countdownInterval = null;
			}
		}
	});

	let busy = $derived(chat.status === 'submitted' || chat.status === 'streaming');

	function balanceDisplay(b: number | null): string {
		if (b === null) return '—';
		return `₦${(b / 100).toFixed(2)}`;
	}

	function partsOf(m: UIMessage): { text: string; reason: string } {
		return {
			text: m.parts
				.filter((p) => p.type === 'text')
				.map((p) => p.text)
				.join(''),
			reason: m.parts
				.filter((p) => p.type === 'reasoning')
				.map((p) => p.text)
				.join('')
		};
	}

	function toggleReason(id: string) {
		const next = { ...showReason };
		if (showReason[id]) {
			delete next[id];
		} else {
			next[id] = true;
		}
		showReason = next;
	}

	async function ask() {
		const q = question.trim();
		if (!q || busy) return;
		question = '';
		done = false;
		costKobo = null;
		truncated = false;
		await chat.sendMessage({ text: q });
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			ask();
		}
	}
</script>

<button class="btn btn-ghost flex items-center gap-1.5 text-[13px]" onclick={() => (open = true)}>
	<Sparkles size={15} /> AI
</button>

<Modal bind:open wide title="ask AI about {peerName || 'this thread'}">
	<div class="flex h-full flex-col gap-4">
		<div class="flex flex-1 flex-col gap-3 overflow-y-auto">
			{#if chat.messages.length === 0}
				<p class="text-[13px] text-faint">
					Ask anything about this conversation — the AI has read the whole thread.
				</p>
			{/if}
			{#each chat.messages as m (m.id)}
				{@const { text, reason } = partsOf(m)}
				<div
					class="max-w-[85%] rounded-[12px] px-4 py-3 text-[13px] leading-[1.5] {m.role === 'user'
						? 'self-end bg-accent text-accent-ink'
						: 'self-start border border-line bg-panel-solid'}"
				>
					{#if m.role === 'assistant' && reason}
						<button
							class="mb-2.5 flex items-center gap-1.5 text-[12px] text-mute transition-colors duration-300 hover:text-ink"
							onclick={() => toggleReason(m.id)}
							aria-expanded={!!showReason[m.id]}
						>
							<Brain size={13} />
							<span>thoughts</span>
							<ChevronDown
								size={13}
								class="transition-transform duration-300 {showReason[m.id] ? 'rotate-180' : ''}"
							/>
						</button>
						{#if showReason[m.id]}
							<div
								class="mb-3 border-l-2 border-line-2 pl-3 text-[12.5px] italic leading-[1.6] text-ink-soft whitespace-pre-wrap"
							>
								{reason}
							</div>
						{/if}
					{/if}
					{text}
				</div>
			{/each}
			{#if chat.status === 'error'}
				<div
					class="max-w-[85%] self-start rounded-[12px] border border-line bg-panel-solid px-4 py-3 text-[13px] leading-[1.5]"
				>
					(service unavailable — try again)
				</div>
			{/if}
			{#if balance !== null && !done}
				<p class="text-[12px] text-mute">balance: {balanceDisplay(balance)}</p>
			{/if}
			{#if costKobo !== null}
				<p class="flex items-center gap-2 text-[12px] text-mute">
					<span>balance: {balanceDisplay(balance)}</span>
					<span class="text-accent">&minus;{balanceDisplay(costKobo)}</span>
					{#if truncated}
						<span class="text-[#e2674c]">(ran out of credit capacity)</span>
					{/if}
				</p>
			{/if}
		</div>

		<div class="flex items-center gap-2 border-t border-line pt-4">
			<input
				class="min-w-0 flex-1 text-[13px]"
				bind:value={question}
				placeholder="ask about this thread…"
				disabled={busy}
				onkeydown={handleKeydown}
			/>
			<button
				class="btn btn-amber shrink-0 !px-4"
				onclick={ask}
				disabled={busy || !question.trim()}
				aria-label="send question"
			>
				{#if busy}
					<LoaderCircle size={18} class="animate-spin" />
				{:else}
					<SendIcon size={18} />
				{/if}
			</button>
		</div>
	</div>
</Modal>
