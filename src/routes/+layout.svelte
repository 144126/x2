<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import '../app.css';

	let { children, data } = $props();
</script>

{#if data.user}
	<header
		class="sticky top-0 z-10 border-b border-line bg-base/80 backdrop-blur-md"
	>
		<nav class="wrap flex items-baseline justify-between py-5">
			<a href="/app" class="font-display text-[21px] font-medium tracking-[-0.02em]">
				x2<span class="text-accent">.</span><i class="font-display text-[16px] font-normal italic text-ink-soft">studio</i>
			</a>
			<div class="flex flex-wrap items-baseline justify-end gap-3 sm:gap-6">
				<a
					href="/app"
					class="group relative pb-0.5 text-[11px] uppercase tracking-[0.22em] transition-colors duration-300 {($page
						.url.pathname === '/app'
						? 'text-ink'
						: 'text-mute')}"
				>
					people
					<span
						class="absolute -bottom-px left-0 h-px w-full origin-left scale-x-0 bg-accent transition-transform duration-[400ms] ease-studio group-hover:scale-x-100 {$page
							.url.pathname === '/app'
							? 'scale-x-100'
							: ''}"
					></span>
				</a>
				<a
					href="/app/random"
					class="group relative pb-0.5 text-[11px] uppercase tracking-[0.22em] transition-colors duration-300 {($page
						.url.pathname === '/app/random'
						? 'text-ink'
						: 'text-mute')}"
				>
					random
					<span
						class="absolute -bottom-px left-0 h-px w-full origin-left scale-x-0 bg-accent transition-transform duration-[400ms] ease-studio group-hover:scale-x-100 {$page
							.url.pathname === '/app/random'
							? 'scale-x-100'
							: ''}"
					></span>
				</a>
				<a
					href="/app/profile"
					class="group relative pb-0.5 text-[11px] uppercase tracking-[0.22em] transition-colors duration-300 {($page
						.url.pathname === '/app/profile'
						? 'text-ink'
						: 'text-mute')}"
				>
					profile
					<span
						class="absolute -bottom-px left-0 h-px w-full origin-left scale-x-0 bg-accent transition-transform duration-[400ms] ease-studio group-hover:scale-x-100 {$page
							.url.pathname === '/app/profile'
							? 'scale-x-100'
							: ''}"
					></span>
				</a>
				<button
					class="text-[11px] uppercase tracking-[0.22em] text-mute transition-colors duration-300 hover:text-ink"
					onclick={async () => {
						await fetch('/logout', { method: 'POST' });
						goto('/login');
					}}>sign out</button
				>
			</div>
		</nav>
	</header>
{/if}

<main class="wrap pb-24 pt-14">
	{@render children()}
</main>
