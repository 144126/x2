<script lang="ts">
	import Modal from './Modal.svelte';
	import { Sparkles, Send as SendIcon, LoaderCircle } from '@lucide/svelte';

	let {
		conv,
		peerName = ''
	}: {
		conv: string;
		peerName?: string;
	} = $props();

	let open = $state(false);
	let question = $state('');
	let busy = $state(false);
	let transcript = $state<{ role: 'user' | 'assistant'; text: string }[]>([]);
	let balance = $state<number | null>(null);
	let maxSeconds = $state(0);
	let koboPerSec = $state(0);
	let costKobo = $state<number | null>(null);
	let truncated = $state(false);
	let done = $state(false);
	let countdownInterval: ReturnType<typeof setInterval> | null = null;
	let startBalance = $state(0);

	function balanceDisplay(b: number | null): string {
		if (b === null) return '—';
		return `₦${(b / 100).toFixed(2)}`;
	}

	async function ask() {
		const q = question.trim();
		if (!q || busy) return;
		question = '';
		busy = true;
		done = false;
		costKobo = null;
		truncated = false;
		transcript = [...transcript, { role: 'user', text: q }];

		const res = await fetch('/api/ai/thread', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ conv, question: q })
		});

		if (!res.ok) {
			transcript = [...transcript, { role: 'assistant', text: '(service unavailable — try again)' }];
			busy = false;
			return;
		}

		const reader = res.body?.getReader();
		if (!reader) {
			transcript = [...transcript, { role: 'assistant', text: '(service unavailable)' }];
			busy = false;
			return;
		}

		let assistantText = '';
		const decoder = new TextDecoder();
		let leftover = '';

		while (true) {
			const { done: readDone, value } = await reader.read();
			if (readDone && !leftover) break;

			const chunk = value ? decoder.decode(value, { stream: true }) : '';
			leftover += chunk;
			const lines = leftover.split('\n');
			leftover = lines.pop() ?? '';

			for (const line of lines) {
				if (line.startsWith('event: ')) {
					const eventType = line.slice(7).trim();
					// next line should be data:
					continue;
				}
				if (line.startsWith('data: ')) {
					try {
						const data = JSON.parse(line.slice(6));
						if (data.kobo_per_sec) {
							koboPerSec = data.kobo_per_sec;
							maxSeconds = data.max_seconds;
							balance = data.balance;
							startBalance = data.balance;
							if (koboPerSec > 0) {
								countdownInterval = setInterval(() => {
									if (balance !== null && balance > 0) {
										balance = Math.max(0, balance - Math.round(koboPerSec));
									}
								}, 1000);
							}
						}
						if (data.text) {
							assistantText += data.text;
							const idx = transcript.findIndex((t) => t.role === 'assistant' && t.text === assistantText.slice(0, -data.text.length));
							if (idx >= 0) {
								transcript = [...transcript.slice(0, idx), { role: 'assistant', text: assistantText }];
							} else {
								transcript = [...transcript, { role: 'assistant', text: assistantText }];
							}
						}
						if (data.balance !== undefined && data.cost_kobo !== undefined) {
							balance = data.balance;
							costKobo = data.cost_kobo;
							truncated = data.truncated;
							done = true;
							if (countdownInterval) clearInterval(countdownInterval);
							countdownInterval = null;
						}
						if (data.reason) {
							transcript = [...transcript, { role: 'assistant', text: `(${data.reason})` }];
							done = true;
							busy = false;
							if (countdownInterval) clearInterval(countdownInterval);
							countdownInterval = null;
						}
					} catch {}
				}
			}
		}

		busy = false;
		if (countdownInterval) clearInterval(countdownInterval);
		countdownInterval = null;
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

<Modal bind:open wide title="Ask AI about this thread">
	<div class="flex h-full flex-col gap-4">
		<div class="flex flex-1 flex-col gap-3 overflow-y-auto">
			{#if transcript.length === 0}
				<p class="text-[13px] text-faint">Ask anything about this conversation — the AI has
				read the whole thread.</p>
			{/if}
			{#each transcript as entry, i (i)}
				<div
					class="max-w-[85%] rounded-[12px] px-4 py-3 text-[14px] leading-[1.5] {entry.role === 'user'
						? 'self-end bg-accent text-accent-ink'
						: 'self-start border border-line bg-panel-solid'}"
				>
					{entry.text}
				</div>
			{/each}
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
				class="min-w-0 flex-1 text-[14px]"
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
