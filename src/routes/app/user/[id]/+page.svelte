<script lang="ts">
	import { goto } from '$app/navigation';
	import type { User } from '$lib/types';
	let { data } = $props();
	let u = $state(data.u as User);
	let username = $derived(u.u || u.m?.split('@')[0] || 'user');
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
