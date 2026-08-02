<script lang="ts">
	import { Search, Users } from '@lucide/svelte';
	let { data } = $props();
	let q = $state('');
</script>

<svelte:head>
	<title>x2 — find a room, find your people</title>
	<meta name="description" content="search rooms built around what you're into, join in a click, or match one-to-one. no feed, no profile to perform for." />
</svelte:head>

<section class="wrap flex min-h-[40vh] flex-col justify-center pt-[8vh]">
	<div class="eyebrow reveal" style="--i:0">x2 — the room finds you</div>
	<h1 class="display reveal mt-5 text-[clamp(40px,7vw,88px)] text-ink" style="--i:1">
		find a room. <em class="italic text-accent">then your people.</em>
	</h1>
	<p class="reveal mt-6 max-w-[520px] text-[16px] leading-[1.65] text-ink-soft" style="--i:2">
		every room here is built around one thing people actually care about. search it, join it,
		and you're already talking to people who get it — no cold-opens, no empty feed, no profile
		to perform for first.
	</p>
	<form
		class="reveal mt-8 flex max-w-[520px] gap-3"
		style="--i:3"
		method="GET"
	>
		<div class="relative min-w-0 flex-1">
			<Search size={18} class="pointer-events-none absolute top-1/2 left-[18px] -translate-y-1/2 text-faint" />
			<input class="w-full py-4 pr-[18px] pl-[46px] text-[17px]" name="q" bind:value={q} placeholder="search rooms by what they're about…" />
		</div>
		<button class="btn btn-amber px-6" type="submit">search</button>
	</form>
</section>

<section class="wrap pb-[10vh]">
	<ul class="mt-4 grid gap-3.5 sm:grid-cols-2">
		{#each data.rooms as g, i (g.id)}
			<li class="card reveal" style="--i:{i}">
				<a href="/app/rooms/{g.id}" class="font-display text-[20px] font-medium tracking-[-0.01em] hover:text-accent">{g.name}</a>
				<p class="mt-2 line-clamp-2 text-[13.5px] text-ink-soft">{g.description}</p>
				<span class="mt-3 flex items-center gap-1 text-[12px] text-mute">
					<Users size={13} /> {g.members.length} member{g.members.length === 1 ? '' : 's'}
				</span>
			</li>
		{/each}
	</ul>
	<div class="mt-10 text-center">
		<a class="btn btn-amber px-8 py-3.5 text-[14px]" href="/app/rooms">start free — join or create a room</a>
	</div>
</section>
