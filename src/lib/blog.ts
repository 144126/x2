import { marked } from 'marked';

export type Faq = { q: string; a: string };

export type Post = {
	slug: string;
	title: string;
	description: string;
	published: string;
	date: string;
	tags: string[];
	keywords: string[];
	faq: Faq[];
	html: string;
};

function unquote(s: string): string {
	return s.trim().replace(/^"|"$/g, '').replace(/\\"/g, '"');
}

function parse_list(value: string | undefined): string[] {
	if (!value) return [];
	const inner = value.trim().replace(/^\[|\]$/g, '');
	if (!inner) return [];
	return inner.split(/,\s*/).map(unquote).filter(Boolean);
}

function split_fm(raw: string): { meta: string; body: string } {
	const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
	if (!m) return { meta: '', body: raw };
	return { meta: m[1], body: raw.slice(m[0].length) };
}

// the frontmatter is a small, consistent shape (flat keys plus a faq block), so a
// targeted parser beats dragging in a yaml dependency — every field is quoted strings.
function parse_fm(block: string): { fields: Record<string, string>; faq: Faq[] } {
	const fields: Record<string, string> = {};
	const faq: Faq[] = [];
	let in_faq = false;
	let curq = '';
	for (const line of block.split(/\r?\n/)) {
		const t = line.trim();
		if (t === 'faq:') {
			in_faq = true;
			continue;
		}
		if (in_faq) {
			const q = t.match(/^-\s*q:\s*"(.*)"\s*$/);
			if (q) {
				curq = q[1];
				continue;
			}
			const a = t.match(/^a:\s*"(.*)"\s*$/);
			if (a) {
				if (curq) faq.push({ q: curq, a: a[1] });
				curq = '';
				continue;
			}
			if (/^[a-z_]+\s*:/.test(t)) {
				in_faq = false;
			} else {
				continue;
			}
		}
		const kv = t.match(/^([a-z_]+):\s*(.*)$/);
		if (kv) fields[kv[1]] = kv[2];
	}
	return { fields, faq };
}

const MONTHS = [
	'January',
	'February',
	'March',
	'April',
	'May',
	'June',
	'July',
	'August',
	'September',
	'October',
	'November',
	'December'
];

export function fmt_date(iso: string): string {
	const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
	if (!m) return iso;
	const month = MONTHS[Number(m[2]) - 1] ?? m[2];
	return `${month} ${Number(m[3])}, ${m[1]}`;
}

export const posts: Post[] = Object.entries(
	import.meta.glob('../../content/blog/*.md', {
		eager: true,
		query: '?raw',
		import: 'default'
	}) as Record<string, string>
)
	.map(([path, raw]) => {
		const { meta, body } = split_fm(raw);
		const { fields, faq } = parse_fm(meta);
		const slug = fields.slug ?? path.split('/').pop()!.replace(/\.md$/, '');
		const published = fields.published ?? '';
		return {
			slug,
			title: unquote(fields.title ?? slug),
			description: unquote(fields.meta_description ?? ''),
			published,
			date: fmt_date(published),
			tags: parse_list(fields.tags),
			keywords: parse_list(fields.secondary_keywords),
			faq,
			html: marked.parse(body)
		};
	})
	.sort((a, b) => b.published.localeCompare(a.published));
