<script lang="ts">
	import { goto } from '$app/navigation';
	import type { User } from '$lib/types';
	let { data } = $props();
	let u = $state(data.u as User);
	let username = $derived(u.u || u.m?.split('@')[0] || 'user');
	let shared = $derived((data.shared ?? []) as { id: string; name: string }[]);
	let showAllShared = $state(false);

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
	<h1 class="display mt-3 mb-10 text-[clamp(40px,6vw,64px)]">{username}</h1>

	<div class="card mb-6 flex flex-col gap-3">
		{#if u.co}
			<div class="flex items-baseline gap-3">
				<span class="eyebrow w-[100px] shrink-0">country</span>
				<span class="text-[14px] text-ink">{u.co}</span>
			</div>
		{/if}
		{#if u.st}
			<div class="flex items-baseline gap-3">
				<span class="eyebrow w-[100px] shrink-0">state</span>
				<span class="text-[14px] text-ink">{u.st}</span>
			</div>
		{/if}
		{#if u.ci}
			<div class="flex items-baseline gap-3">
				<span class="eyebrow w-[100px] shrink-0">city</span>
				<span class="text-[14px] text-ink">{u.ci}</span>
			</div>
		{/if}
		{#if u.ag}
			<div class="flex items-baseline gap-3">
				<span class="eyebrow w-[100px] shrink-0">age</span>
				<span class="text-[14px] text-ink">{u.ag}</span>
			</div>
		{/if}
		{#if u.r}
			<div class="flex items-baseline gap-3">
				<span class="eyebrow w-[100px] shrink-0">gender</span>
				<span class="text-[14px] text-ink">{u.r}</span>
			</div>
		{/if}
		{#if u.w}
			<div class="flex items-baseline gap-3">
				<span class="eyebrow w-[100px] shrink-0">phone</span>
				<span class="text-[14px] text-ink">{u.w}</span>
			</div>
		{/if}
	</div>

	{#if u.a}
		<div class="card mb-6">
			<p class="text-[14.5px] leading-[1.6] text-ink-soft">{u.a}</p>
		</div>
	{/if}

	{#if u.i?.length}
		<div class="card mb-6 flex flex-wrap gap-2">
			{#each u.i as t}
				<span class="rounded-full border border-line bg-panel px-3 py-1 text-[13px] text-ink">{t}</span>
			{/each}
		</div>
	{/if}

	{#if shared.length}
		<div class="card mb-6">
			<button
				class="flex w-full items-center justify-between text-left"
				onclick={() => (showAllShared = !showAllShared)}
			>
				<span class="text-[14.5px] text-ink-soft">
					{shared.length} group{shared.length === 1 ? '' : 's'} in common
				</span>
				<span class="text-[10px] text-faint transition-transform duration-300 {showAllShared ? 'rotate-180' : ''}">▾</span>
			</button>
			{#if showAllShared}
				<ul class="mt-3 flex flex-col gap-2">
					{#each shared as g (g.id)}
						<li>
							<a
								href="/app/groups/{g.id}"
								class="text-[14px] text-ink transition-colors duration-300 hover:text-accent"
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
			<p class="text-[14px] text-ink">{commonText}</p>
		{:else}
			<button class="btn text-[13px]" disabled={commonLoading} onclick={findCommon}>
				{commonLoading ? 'thinking…' : 'what do we have in common?'}
			</button>
			{#if commonError === 'insufficient_credits'}
				<p class="mt-2 text-[12px] text-mute">out of credits — back tomorrow, or buy more on your profile.</p>
			{:else if commonError === 'llm_error'}
				<p class="mt-2 text-[12px] text-mute">couldn't figure that out just now — try again.</p>
			{/if}
		{/if}
	</div>

	<div class="flex gap-3">
		<button class="btn btn-amber" onclick={() => goto('/app/chat/' + data.id)}>chat</button>
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
