<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import '../app.css';
	import NotifyPrompt from '$lib/components/NotifyPrompt.svelte';
	import InstallBanner from '$lib/components/InstallBanner.svelte';
	import { sync_badge } from '$lib/badge';
	import { sync_subscription } from '$lib/push-client';
	import { Users, DoorOpen, UserRound, LogOut } from '@lucide/svelte';

	let { children, data } = $props();
	let vapid_key = $state('');

	onMount(async () => {
		if (!data.user) return;
		if ('serviceWorker' in navigator) {
			navigator.serviceWorker.register('/service-worker.js').catch(() => {});
		}
		try {
			const res = await fetch('/api/push');
			if (res.ok) {
				const { key } = (await res.json()) as { key: string };
				vapid_key = key;
				await sync_subscription(key);
			}
		} catch {
			/* push unavailable — the app still works without it */
		}
		await sync_badge();
		document.addEventListener('visibilitychange', () => {
			if (document.visibilityState === 'visible') sync_badge();
		});
	});

	const nav = [
		{ href: '/app', label: 'people', icon: Users },
		{ href: '/app/groups', label: 'rooms', icon: DoorOpen },
		{ href: '/app/profile', label: 'profile', icon: UserRound }
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
				x<span class="text-accent">2</span>
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
					class="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.22em] text-mute transition-colors duration-300 hover:text-ink"
					onclick={sign_out}
				>
					<LogOut size={13} /> sign out
				</button>
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
				class="flex flex-col items-center gap-1 py-2.5 text-center text-[10px] uppercase tracking-[0.18em] transition-colors duration-300 {active(
					item.href
				)
					? 'text-accent'
					: 'text-mute'}"
			>
				<item.icon size={19} />
				{item.label}
			</a>
		{/each}
	</nav>
	<InstallBanner />
	{#if vapid_key}
		<NotifyPrompt {vapid_key} />
	{/if}
{/if}
