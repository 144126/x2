<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import MuteButton from '$lib/components/MuteButton.svelte';
	import type { User } from '$lib/types';
	import { local_time } from '$lib/tz';
	let { data } = $props();
	let u = $state(data.u as User);
	let muted = $state(data.muted as boolean);
	let username = $derived(u.u || u.m?.split('@')[0] || 'user');
	let shared = $derived((data.shared ?? []) as { id: string; name: string }[]);
	let showAllShared = $state(false);

	let viewerTz = $derived(
		typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined
	);

	let localTime = $derived.by(() => {
		if (!data.tz) return null;
		const now = Date.now();
		const t = local_time(data.tz, now);
		if (!viewerTz || viewerTz === data.tz) return t;
		const here = offset(viewerTz, now);
		const there = offset(data.tz, now);
		const diff = (there - here) / 60;
		if (diff === 0) return t;
		const dir = diff > 0 ? 'behind' : 'ahead';
		return `${t} · ${Math.abs(diff)}h ${dir} you`;
	});

	function offset(tz: string, ts: number): number {
		try {
			const parts = new Intl.DateTimeFormat('en', {
				timeZone: tz,
				timeZoneName: 'longOffset',
				hour12: false
			}).formatToParts(new Date(ts));
			const off = parts.find((p) => p.type === 'timeZoneName')?.value;
			if (!off) return 0;
			const m = off.match(/UTC([+-])(\d+):?(\d+)?/);
			if (!m) return 0;
			return (parseInt(m[2]) * 60 + (parseInt(m[3]) || 0)) * (m[1] === '+' ? 1 : -1);
		} catch {
			return 0;
		}
	}

	let commonText = $state<string | null>(null);
	let commonLoading = $state(false);
	let commonError = $state<'insufficient_credits' | 'llm_error' | null>(null);

	async function findCommon() {
		commonLoading = true;
		commonError = null;
		const res = await fetch(`/api/user/${data.id}/common`);
		const body = await res.json();
		commonLoading = false;
		if (body.ok) commonText = body.text;
		else commonError = body.reason ?? 'llm_error';
	}
</script>

<section class="prof reveal mx-auto max-w-[560px]">
	<div class="eyebrow">user</div>
	<h1 class="display mt-3 mb-6 text-[clamp(24px,4vw,34px)]">{username}</h1>

	<div class="card mb-6 flex flex-col gap-3">
		{#if u.co}
			<div class="flex items-baseline gap-3">
				<span class="eyebrow w-[100px] shrink-0">country</span>
				<span class="text-[13px] text-ink">{u.co}</span>
			</div>
		{/if}
		{#if u.st}
			<div class="flex items-baseline gap-3">
				<span class="eyebrow w-[100px] shrink-0">state</span>
				<span class="text-[13px] text-ink">{u.st}</span>
			</div>
		{/if}
		{#if u.ci}
			<div class="flex items-baseline gap-3">
				<span class="eyebrow w-[100px] shrink-0">city</span>
				<span class="text-[13px] text-ink">{u.ci}</span>
			</div>
		{/if}
		{#if u.ag}
			<div class="flex items-baseline gap-3">
				<span class="eyebrow w-[100px] shrink-0">age</span>
				<span class="text-[13px] text-ink">{u.ag}</span>
			</div>
		{/if}
		{#if u.r}
			<div class="flex items-baseline gap-3">
				<span class="eyebrow w-[100px] shrink-0">gender</span>
				<span class="text-[13px] text-ink">{u.r}</span>
			</div>
		{/if}
		{#if u.w}
			<div class="flex items-baseline gap-3">
				<span class="eyebrow w-[100px] shrink-0">phone</span>
				<span class="text-[13px] text-ink">{u.w}</span>
			</div>
		{/if}
		{#if localTime}
			<div class="flex items-baseline gap-3">
				<span class="eyebrow w-[100px] shrink-0">local time</span>
				<span class="text-[13px] text-ink">{localTime}</span>
			</div>
		{/if}
	</div>

	{#if u.a}
		<div class="card mb-6">
			<p class="text-[13px] leading-[1.6] text-ink-soft">{u.a}</p>
		</div>
	{/if}

	{#if shared.length}
		<div class="card mb-6">
			<button
				class="flex w-full items-center justify-between text-left"
				onclick={() => (showAllShared = !showAllShared)}
			>
				<span class="text-[13px] text-ink-soft">
					{shared.length} group{shared.length === 1 ? '' : 's'} in common
				</span>
				<span
					class="text-[10px] text-faint transition-transform duration-300 {showAllShared
						? 'rotate-180'
						: ''}">▾</span
				>
			</button>
			{#if showAllShared}
				<ul class="mt-3 flex flex-col gap-2">
					{#each shared as g (g.id)}
						<li>
							<a
								href="/~{g.id}"
								class="text-[13px] text-ink transition-colors duration-300 hover:text-accent"
							>
								{g.name}
							</a>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	{/if}

	<div class="card mb-6">
		{#if commonText}
			<p class="text-[13px] text-ink">{commonText}</p>
		{:else}
			<button class="btn text-[13px]" disabled={commonLoading} onclick={findCommon}>
				{commonLoading ? 'thinking…' : 'what do we have in common?'}
			</button>
			{#if commonError === 'insufficient_credits'}
				<p class="mt-2 text-[12px] text-mute">
					out of credits — back tomorrow, or buy more on your profile.
				</p>
			{:else if commonError === 'llm_error'}
				<p class="mt-2 text-[12px] text-mute">couldn't figure that out just now — try again.</p>
			{/if}
		{/if}
	</div>

	<div class="flex gap-3">
		<button class="btn btn-amber" onclick={() => goto('/chat/' + data.id)}>chat</button>
		{#if data.id !== $page.data.user?.id}
			<MuteButton target={data.id} kind="u" bind:muted label="notifications from this person" />
		{/if}
		{#if data.wu}
			<a
				href={data.wu}
				target="_blank"
				rel="noopener noreferrer"
				class="btn text-[13px] no-underline"
			>
				whatsapp
			</a>
		{/if}
	</div>
</section>
