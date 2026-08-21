<script lang="ts">
	let { data } = $props();
	const post = data.post;
	const url = `${data.origin}/blog/${post.slug}`;

	const ld = JSON.stringify([
		{
			'@context': 'https://schema.org',
			'@type': 'BlogPosting',
			headline: post.title,
			description: post.description,
			datePublished: post.published,
			mainEntityOfPage: url,
			author: { '@type': 'Organization', name: 'x2', url: data.origin },
			publisher: { '@type': 'Organization', name: 'x2', url: data.origin }
		},
		...(post.faq.length
			? [
					{
						'@context': 'https://schema.org',
						'@type': 'FAQPage',
						mainEntity: post.faq.map((f) => ({
							'@type': 'Question',
							name: f.q,
							acceptedAnswer: { '@type': 'Answer', text: f.a }
						}))
					}
				]
			: []),
		{
			'@context': 'https://schema.org',
			'@type': 'BreadcrumbList',
			itemListElement: [
				{ '@type': 'ListItem', position: 1, name: 'x2', item: data.origin },
				{ '@type': 'ListItem', position: 2, name: 'x2 reads', item: `${data.origin}/blog` },
				{ '@type': 'ListItem', position: 3, name: post.title, item: url }
			]
		}
	]);
</script>

<svelte:head>
	<title>{post.title}</title>
	<meta name="description" content={post.description} />
	<link rel="canonical" href={url} />
	<meta property="og:type" content="article" />
	<meta property="og:site_name" content="x2" />
	<meta property="og:title" content={post.title} />
	<meta property="og:description" content={post.description} />
	<meta property="og:url" content={url} />
	<meta property="og:image" content="{data.origin}/icons/icon-512-maskable.png" />
	<meta name="twitter:card" content="summary" />
	<meta name="twitter:title" content={post.title} />
	<meta name="twitter:description" content={post.description} />
	{#each post.keywords as keyword (keyword)}
		<meta name="keywords" content={keyword} />
	{/each}
	{@html '<script type="application/ld+json">' + ld + '</script>'}
</svelte:head>

<article class="mx-auto w-full max-w-[720px] py-10">
	<nav class="text-[12px] text-mute">
		<a href="/" class="hover:text-ink">x2</a>
		<span aria-hidden="true"> · </span>
		<a href="/blog" class="hover:text-ink">reads</a>
	</nav>

	<header class="mt-4">
		<h1 class="display text-[clamp(24px,4.6vw,38px)] leading-[1.15]">{post.title}</h1>
		<p class="mt-3 text-[12px] uppercase tracking-[0.18em] text-mute">{post.date}</p>
	</header>

	<div class="prose mt-8 text-[15px] leading-[1.75] text-ink-soft">{@html post.html}</div>

	<div class="mt-10 flex flex-wrap gap-1.5">
		{#each post.tags as tag (tag)}
			<span class="rounded-full border border-line px-2.5 py-0.5 text-[11px] text-mute">{tag}</span>
		{/each}
	</div>

	<footer class="mt-10 border-t border-line pt-6">
		<p class="text-[14px] leading-[1.6] text-ink-soft">
			Prefer talking to reading? <a href="/" class="text-accent underline underline-offset-2"
				>search rooms on x2</a
			> built around whatever you're into — no account to look.
		</p>
	</footer>
</article>

<style>
	/* served markdown is arbitrary element HTML, so it needs a scoped stylesheet —
	   utilities can't reach into the rendered nodes. Tokens stay on the theme vars. */
	.prose h2 {
		margin: 2.2em 0 0.6em;
		font-family: var(--font-display);
		font-size: 1.4em;
		font-weight: 500;
		letter-spacing: -0.01em;
		color: var(--color-ink);
	}
	.prose h2:first-child {
		margin-top: 0;
	}
	.prose p {
		margin: 0 0 1.15em;
	}
	.prose strong {
		color: var(--color-ink);
		font-weight: 500;
	}
	.prose em {
		color: var(--color-ink);
	}
	.prose a {
		color: var(--color-accent);
		text-decoration: underline;
		text-underline-offset: 2px;
	}
	.prose ul,
	.prose ol {
		margin: 0 0 1.15em;
		padding-left: 1.2em;
	}
	.prose li {
		margin: 0 0 0.55em;
	}
	.prose blockquote {
		margin: 1.5em 0;
		border-left: 2px solid var(--color-accent);
		padding-left: 1em;
		color: var(--color-ink);
	}
	.prose hr {
		margin: 2.5em 0;
		border: 0;
		border-top: 1px solid var(--color-line);
	}
	.prose table {
		margin: 1.5em 0;
		width: 100%;
		border-collapse: collapse;
		font-size: 0.92em;
	}
	.prose th,
	.prose td {
		border: 1px solid var(--color-line);
		padding: 0.5em 0.7em;
		text-align: left;
		vertical-align: top;
	}
	.prose th {
		color: var(--color-ink);
		font-weight: 500;
	}
	@media (max-width: 640px) {
		.prose table {
			font-size: 0.82em;
		}
	}
</style>
