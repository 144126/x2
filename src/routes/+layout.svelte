<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import '../app.css';

	let { children, data } = $props();

	const nav = [
		{ href: '/app', label: 'people' },
		{ href: '/app/groups', label: 'rooms' },
		{ href: '/app/random', label: 'discover' },
		{ href: '/app/profile', label: 'profile' }
	];
	let here = $derived($page.url.pathname);
	const active = (href: string) => (href === '/app' ? here === '/app' : here.startsWith(href));

	async function sign_out() {
		await fetch('/logout', { method: 'POST' });
		goto('/login');
	}
</script>

{#if data.user}
	<header class="sticky top-0 z-10 border-b border-line bg-base/80 backdrop-blur-md">
		<nav class="wrap flex items-baseline justify-between gap-4 py-5">
			<a href="/app" class="shrink-0 font-display text-[21px] font-medium tracking-[-0.02em]">
				x2<span class="text-accent">.</span><i
					class="font-display text-[16px] font-normal italic text-ink-soft">studio</i
				>
			</a>
			<!-- links live in the bottom bar on phones; only the sign-out stays up here -->
			<div class="flex items-baseline justify-end gap-6">
				<div class="hidden items-baseline gap-6 sm:flex">
					{#each nav as item (item.href)}
						<a
							href={item.href}
							class="group relative pb-0.5 text-[11px] uppercase tracking-[0.22em] transition-colors duration-300 {active(
								item.href
							)
								? 'text-ink'
								: 'text-mute'}"
						>
							{item.label}
							<span
								class="absolute -bottom-px left-0 h-px w-full origin-left scale-x-0 bg-accent transition-transform duration-[400ms] ease-studio group-hover:scale-x-100 {active(
									item.href
								)
									? 'scale-x-100'
									: ''}"
							></span>
						</a>
					{/each}
				</div>
				<button
					class="text-[11px] uppercase tracking-[0.22em] text-mute transition-colors duration-300 hover:text-ink"
					onclick={sign_out}>sign out</button
				>
			</div>
		</nav>
	</header>
{/if}

<main class="wrap pb-24 pt-14 max-sm:pb-[calc(76px+env(safe-area-inset-bottom))] max-sm:pt-8">
	{@render children()}
</main>

{#if data.user}
	<nav
		class="fixed inset-x-0 bottom-0 z-10 grid grid-cols-4 border-t border-line bg-base/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md sm:hidden"
	>
		{#each nav as item (item.href)}
			<a
				href={item.href}
				class="py-3.5 text-center text-[10px] uppercase tracking-[0.18em] transition-colors duration-300 {active(
					item.href
				)
					? 'text-accent'
					: 'text-mute'}"
			>
				{item.label}
			</a>
		{/each}
	</nav>
{/if}
