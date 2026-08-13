<script lang="ts">
	type Option = { value: string; label: string };

	let {
		value = $bindable(''),
		options,
		placeholder = 'select…',
		'aria-label': ariaLabel
	}: {
		value?: string;
		options: Option[];
		placeholder?: string;
		'aria-label'?: string;
	} = $props();

	const uid = Math.random().toString(36).slice(2);
	const opt_id = (i: number) => `select-${uid}-opt-${i}`;

	let open = $state(false);
	let highlighted = $state(0);
	let trigger: HTMLButtonElement | undefined = $state();
	let listbox: HTMLUListElement | undefined = $state();
	const listbox_id = `select-${uid}-listbox`;
	let typeahead = '';
	let typeahead_timer: ReturnType<typeof setTimeout> | null = null;

	let selected_index = $derived(options.findIndex((o) => o.value === value));
	let selected_label = $derived(selected_index >= 0 ? options[selected_index].label : placeholder);

	function open_list() {
		// nothing highlighted yet when there's no selection — the first arrow press then
		// lands on the first option, rather than skipping straight to the second
		highlighted = selected_index;
		open = true;
	}

	function close_list(refocus = false) {
		open = false;
		if (refocus) trigger?.focus();
	}

	function commit(i: number) {
		if (options[i]) value = options[i].value;
		close_list(true);
	}

	function on_trigger_keydown(e: KeyboardEvent) {
		if (!open) {
			if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				open_list();
			}
			return;
		}
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			highlighted = Math.min(highlighted + 1, options.length - 1);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			highlighted = Math.max(highlighted - 1, 0);
		} else if (e.key === 'Home') {
			e.preventDefault();
			highlighted = 0;
		} else if (e.key === 'End') {
			e.preventDefault();
			highlighted = options.length - 1;
		} else if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			commit(highlighted);
		} else if (e.key === 'Escape') {
			e.preventDefault();
			close_list(true);
		} else if (e.key.length === 1) {
			e.preventDefault();
			typeahead += e.key.toLowerCase();
			if (typeahead_timer) clearTimeout(typeahead_timer);
			typeahead_timer = setTimeout(() => (typeahead = ''), 600);
			const from = highlighted + 1;
			const ordered = [...options.slice(from), ...options.slice(0, from)];
			const hit = ordered.find((o) => o.label.toLowerCase().startsWith(typeahead));
			if (hit) highlighted = options.indexOf(hit);
		}
	}

	function on_document_click(e: MouseEvent) {
		if (!open) return;
		const target = e.target as Node;
		if (trigger?.contains(target) || listbox?.contains(target)) return;
		close_list(false);
	}
</script>

<svelte:window onclick={on_document_click} />

<div class="relative inline-block w-full">
	<button
		type="button"
		bind:this={trigger}
		class="flex w-full items-center justify-between gap-2 rounded-[10px] border border-line bg-panel-solid px-3.5 py-2.5 text-left text-[13px] text-ink transition-colors duration-300 focus:border-accent focus:outline-none"
		role="combobox"
		aria-haspopup="listbox"
		aria-expanded={open}
		aria-controls={listbox_id}
		aria-label={ariaLabel}
		onclick={() => (open ? close_list(false) : open_list())}
		onkeydown={on_trigger_keydown}
	>
		<span class={selected_index < 0 ? 'text-mute' : ''}>{selected_label}</span>
		<span
			class="text-[10px] text-faint transition-transform duration-300 {open ? 'rotate-180' : ''}"
			>▾</span
		>
	</button>

	{#if open}
		<ul
			bind:this={listbox}
			id={listbox_id}
			role="listbox"
			tabindex="-1"
			class="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-[10px] border border-line bg-panel-solid py-1 shadow-lg"
			aria-activedescendant={opt_id(highlighted)}
		>
			{#each options as o, i (o.value)}
				<li
					id={opt_id(i)}
					role="option"
					aria-selected={o.value === value}
					tabindex="-1"
					class="cursor-pointer px-3.5 py-2 text-[13px] {i === highlighted
						? 'bg-accent-soft text-ink'
						: 'text-ink-soft'}"
					onmouseenter={() => (highlighted = i)}
					onclick={() => commit(i)}
					onkeydown={(e) => {
						if (e.key === 'Enter' || e.key === ' ') {
							e.preventDefault();
							commit(i);
						}
					}}
				>
					{o.label}
				</li>
			{/each}
		</ul>
	{/if}
</div>
