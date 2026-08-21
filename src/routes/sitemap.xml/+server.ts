import { posts } from '$lib/blog';

export function GET({ url }) {
	const origin = url.origin;
	const pages = [
		{ path: '/', pri: '1.0', freq: 'weekly' },
		{ path: '/rooms', pri: '0.7', freq: 'daily' },
		{ path: '/find', pri: '0.6', freq: 'weekly' },
		{ path: '/blog', pri: '0.8', freq: 'weekly' },
		...posts.map((p) => ({
			path: `/blog/${p.slug}`,
			pri: p.slug === 'omegle-alternatives' ? '0.9' : '0.8',
			lastmod: p.published
		}))
	];
	const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages
	.map(
		(p) => `  <url>
    <loc>${origin}${p.path}</loc>${p.lastmod ? `\n    <lastmod>${p.lastmod}</lastmod>` : ''}${p.freq ? `\n    <changefreq>${p.freq}</changefreq>` : ''}
    <priority>${p.pri}</priority>
  </url>`
	)
	.join('\n')}
</urlset>`;
	return new Response(xml, { headers: { 'content-type': 'application/xml; charset=utf-8' } });
}
