// /robots.txt shadows the static one so the Sitemap line can carry the real origin.
const DISALLOW = [
	'/app/',
	'/me',
	'/chats',
	'/chat/',
	'/api/',
	'/groups/',
	'/@',
	'/~',
	'/lock',
	'/logout',
	'/media',
	'/offline',
	'/share',
	'/scheduled',
	'/ua'
];

export function GET({ url }) {
	const body =
		'# x2: crawl the marketing and discover pages, leave the app behind the login wall out\n' +
		'User-agent: *\n' +
		DISALLOW.map((d) => `Disallow: ${d}\n`).join('') +
		`\nSitemap: ${url.origin}/sitemap.xml\n`;
	return new Response(body, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
}
