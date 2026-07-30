<script lang="ts">
	import { X } from '@lucide/svelte';
	import type { Snippet } from 'svelte';

	let {
		open = $bindable(false),
		title = '',
		wide = false,
		children
	}: { open?: boolean; title?: string; wide?: boolean; children: Snippet } = $props();

	// must be $state: bind:this on a plain `let` never re-runs the effect that opens the dialog
	let el: HTMLDialogElement | undefined = $state();

	$effect(() => {
		if (!el) return;
		if (open && !el.open) el.showModal();
		else if (!open && el.open) el.close();
	});
</script>

<dialog
	bind:this={el}
	class="modal-dialog m-auto max-h-[85dvh] {wide ? 'h-[92dvh] w-[min(920px,96vw)]' : 'w-[min(560px,92vw)]'} rounded-[20px] border border-line bg-panel-solid p-0 text-ink shadow-2xl backdrop:bg-black/70 backdrop:backdrop-blur-md"
	onclose={() => (open = false)}
	onclick={(e) => {
		// a click landing on the dialog itself (not its content box) is a backdrop click
		if (e.target === el) open = false;
	}}
>
	<div class="flex max-h-[85dvh] flex-col">
		<header class="flex items-center justify-between gap-4 border-b border-line px-6 py-5">
			<h2 class="font-display text-[20px] font-medium tracking-[-0.01em]">{title}</h2>
			<button
				class="flex h-8 w-8 items-center justify-center rounded-full bg-none leading-none text-ink-soft transition-colors duration-300 hover:bg-panel hover:text-accent"
				onclick={() => (open = false)}
				aria-label="close"
			>
				<X size={17} />
			</button>
		</header>
		<div class="min-h-0 flex-1 overflow-y-auto px-6 py-5">
			{@render children()}
		</div>
	</div>
</dialog>

<style>
	.modal-dialog {
		animation: modal-in 0.35s cubic-bezier(0.16, 1, 0.3, 1) both;
	}
	.modal-dialog::backdrop {
		animation: modal-backdrop-in 0.35s ease both;
	}
	@keyframes modal-in {
		from {
			opacity: 0;
			transform: translateY(10px) scale(0.98);
		}
		to {
			opacity: 1;
			transform: none;
		}
	}
	@keyframes modal-backdrop-in {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}
</style>
