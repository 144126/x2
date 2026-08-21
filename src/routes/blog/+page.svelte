<script lang="ts">
	let { data } = $props();
	const ld = JSON.stringify([
		{
			'@context': 'https://schema.org',
			'@type': 'Blog',
			name: 'x2 reads',
			url: `${data.origin}/blog`,
			description:
				'Guides on random chat, omegle alternatives, making friends online, and staying safe.'
		}
	]);
</script>

<svelte:head>
	<title>omegle alternatives and random chat guides — x2 reads</title>
	<meta
		name="description"
		content="Honest guides on omegle alternatives, random text and video chat, making friends online, no-login chat apps, and staying safe while you talk to strangers."
	/>
	<link rel="canonical" href="{data.origin}/blog" />
	<meta property="og:type" content="website" />
	<meta property="og:site_name" content="x2" />
	<meta property="og:title" content="omegle alternatives and random chat guides — x2 reads" />
	<meta
		property="og:description"
		content="Honest guides on omegle alternatives, random text and video chat, making friends online, no-login chat apps, and staying safe while you talk to strangers."
	/>
	<meta property="og:url" content="{data.origin}/blog" />
	<meta property="og:image" content="{data.origin}/icons/icon-512-maskable.png" />
	<meta name="twitter:card" content="summary" />
	<meta name="twitter:title" content="omegle alternatives and random chat guides — x2 reads" />
	<meta
		name="twitter:description"
		content="Honest guides on omegle alternatives, random chat, making friends online, and staying safe."
	/>
	{@html '<script type="application/ld+json">' + ld + '</script>'}
</svelte:head>

<div class="mx-auto w-full max-w-[760px] py-10">
	<div class="eyebrow">x2 reads</div>
	<h1 class="display text-[clamp(28px,5vw,44px)]">
		omegle alternatives that don't waste your time
	</h1>
	<p class="mt-4 max-w-[620px] leading-[1.7] text-ink-soft">
		Honest guides on replacing omegle, choosing between text, video, and group chat, making friends
		online, and staying safe while you talk to a stranger. No forced signup, no fluff — the same
		rules x2 is built on.
	</p>

	<div class="mt-10 grid gap-4">
		{#each data.posts as post (post.slug)}
			<a
				href="/blog/{post.slug}"
				class="card group flex flex-col gap-2 p-5 transition-colors duration-300 hover:border-accent/40"
			>
				<span class="text-[11px] uppercase tracking-[0.18em] text-mute">{post.date}</span>
				<h2 class="font-display text-[17px] font-medium leading-[1.35] group-hover:text-accent">
					{post.title}
				</h2>
				<p class="text-[13px] leading-[1.6] text-ink-soft">{post.description}</p>
				<div class="mt-1 flex flex-wrap gap-1.5">
					{#each post.tags as tag (tag)}
						<span class="rounded-full border border-line px-2.5 py-0.5 text-[11px] text-mute"
							>{tag}</span
						>
					{/each}
				</div>
			</a>
		{/each}
	</div>

	<p class="mt-10 text-[13px] text-mute">
		Prefer talking to reading? <a href="/" class="text-accent underline underline-offset-2"
			>search rooms on x2</a
		> right now — no account to look.
	</p>
</div>
