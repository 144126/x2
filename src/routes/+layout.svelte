<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { dev } from '$app/environment';
	import { onMount } from 'svelte';
	import '../app.css';
	import NotifyPrompt from '$lib/components/NotifyPrompt.svelte';
	import InstallBanner from '$lib/components/InstallBanner.svelte';
	import { sync_badge } from '$lib/badge';
	import { sync_subscription } from '$lib/push-client';
	import { arm_lock } from '$lib/pin-client';
	import { Search, MessagesSquare, DoorOpen, UserRound, LogOut, Radio } from '@lucide/svelte';

	let { children, data } = $props();
	let vapid_key = $state('');

	onMount(() => {
		if (data.pin_on) return arm_lock();
	});

	onMount(async () => {
		if (!data.user) return;
		if ('serviceWorker' in navigator) {
			navigator.serviceWorker
				.register('/service-worker.js', { type: dev ? 'module' : 'classic' })
				.catch(() => {});
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
		{ href: '/', label: 'talk', icon: Radio },
		{ href: '/rooms', label: 'rooms', icon: DoorOpen },
		{ href: '/chats', label: 'chats', icon: MessagesSquare },
		{ href: '/find', label: 'find', icon: Search },
		{ href: '/profile', label: 'profile', icon: UserRound }
	];
	let here = $derived($page.url.pathname);
	const exact = ['/', '/find'];
	const active = (href: string) => (exact.includes(href) ? here === href : here.startsWith(href));

	// pages that own the whole viewport and scroll inside themselves — they must never
	// hand the shell a page-level scrollbar
	let fit = $derived(/^\/(chat\/[^/]+|~[^/]+)?$/.test(here));

	async function sign_out() {
		await fetch('/logout', { method: 'POST' });
		goto('/login');
	}
</script>

<div class="flex h-[100dvh] flex-col overflow-hidden">
	{#if data.user}
		<header class="shrink-0 border-b border-line bg-base/80 backdrop-blur-md">
			<nav class="wrap flex items-center justify-between gap-4 py-2.5">
				<a href="/" class="shrink-0" aria-label="x2 home">
					<img src="/logo.svg" alt="x2" class="h-5 w-5" />
				</a>
				<!-- links live in the bottom bar on phones; only the sign-out stays up here -->
				<div class="flex items-center justify-end gap-5">
					<div class="hidden items-center gap-5 sm:flex">
						{#each nav as item (item.href)}
							<a
								href={item.href}
								class="group relative pb-0.5 text-[10px] uppercase tracking-[0.2em] transition-colors duration-300 {active(
									item.href
								)
									? 'text-ink'
									: 'text-mute hover:text-ink'}"
							>
								{item.label}
								<span
									class="absolute -bottom-px left-0 h-px w-full origin-left scale-x-0 bg-accent transition-transform duration-300 ease-studio group-hover:scale-x-100 {active(
										item.href
									)
										? 'scale-x-100'
										: ''}"
								></span>
							</a>
						{/each}
					</div>
					<button
						class="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.2em] text-mute transition-colors duration-300 hover:text-ink"
						onclick={sign_out}
					>
						<LogOut size={12} /> sign out
					</button>
				</div>
			</nav>
		</header>
		{#if data.user.is_device}
			<div
				class="wrap flex shrink-0 flex-wrap items-center gap-2 border-b border-line bg-accent-soft py-1.5 text-[11.5px] text-ink-soft"
			>
				<span>you're chatting without an account — link one so you don't lose access.</span>
				<a href="/profile#link-account" class="btn btn-amber ml-auto px-2.5 py-1 text-[11px]"
					>link account</a
				>
			</div>
		{/if}
	{/if}

	<main class="min-h-0 flex-1 {fit ? 'overflow-hidden' : 'overflow-y-auto'}">
		<div class="wrap {fit ? 'h-full' : 'py-6'}">
			{@render children()}
		</div>
	</main>

	{#if data.user}
		<nav
			class="grid shrink-0 border-t border-line bg-base/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md sm:hidden"
			style="grid-template-columns: repeat({nav.length}, minmax(0, 1fr))"
		>
			{#each nav as item (item.href)}
				<a
					href={item.href}
					class="flex flex-col items-center gap-1 py-1.5 text-center text-[9px] uppercase tracking-[0.14em] transition-colors duration-300 {active(
						item.href
					)
						? 'text-accent'
						: 'text-mute'}"
				>
					<item.icon size={17} />
					{item.label}
				</a>
			{/each}
		</nav>
		<InstallBanner />
		{#if vapid_key}
			<NotifyPrompt {vapid_key} />
		{/if}
	{/if}
</div>
